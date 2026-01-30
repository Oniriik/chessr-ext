# Chessr: Suggestion & Stats Computation System
## Engineering Specification v1.0

**Author:** Technical Architecture Team
**Last Updated:** 2026-01-30
**Status:** Implementation Reference
**Target Audience:** Backend/Frontend Engineers implementing or extending Chessr

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [System Overview](#system-overview)
3. [Request/Response Contracts](#requestresponse-contracts)
4. [Suggestion Pipeline (Phase C)](#suggestion-pipeline-phase-c)
5. [Stats Pipeline (Phase A)](#stats-pipeline-phase-a)
6. [Shared Data Model & Caching](#shared-data-model--caching)
7. [Edge Cases & Handling](#edge-cases--handling)
8. [Performance Constraints](#performance-constraints)
9. [Telemetry & Observability](#telemetry--observability)
10. [MCTS vs Classic Search Decision](#mcts-vs-classic-search-decision)
11. [MultiPV Implementation Strategy](#multipv-implementation-strategy)
12. [Consistency & Caching Strategy](#consistency--caching-strategy)
13. [Recommended Architecture](#recommended-architecture)

---

## Executive Summary

Chessr implements a **dual-phase analysis pipeline** that separates accuracy review (full-strength analysis) from user-facing suggestions (ELO-tuned, personality-aware). This separation prevents engine hash contamination and enables independent optimization of each phase.

### Key Architectural Principles

1. **White POV Normalization**: All evaluations stored in White's perspective
2. **Anti-Contamination Reset**: `ucinewgame` between phases prevents analysis leakage
3. **Win% Loss Primary Metric**: More human-aligned than centipawn loss
4. **ELO-Banded Search**: Dynamic depth/time budgets per rating range
5. **MultiPV for Context**: 2-8 candidates provide gap analysis and alternatives

### Suggestion Flow (Single-Line Overview)

```
1. Client captures position (FEN + history)
2. WebSocket sends AnalyzeRequest with movesUci[] + user settings
3. Server acquires engine from pool
4. Phase A: Full-strength accuracy review (last N moves, MultiPV=2, 80ms/ply)
5. Phase B: Engine reset (ucinewgame) to clear hash tables
6. Phase C: ELO-tuned suggestion generation (MultiPV=user.multiPV, dynamic time)
7. Server returns AnalyzeResultResponse with accuracy + suggestions
8. Client displays rolling accuracy + 1-3 best suggestions with labels
9. Client tracks next played move and correlates with suggestions
10. Client incremental stats update on subsequent requests
```

---

## System Overview

### Architecture Diagram (ASCII)

```
┌─────────────────────────────────────────────────────────────────┐
│                        CHESS.COM / LICHESS                       │
│  (DOM observers extract: FEN, movesUci[], sideToMove, gameId)   │
└───────────────────────────┬─────────────────────────────────────┘
                            │ 1. Position detected
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      EXTENSION CLIENT                            │
│  Content Script → WebSocket Client → State Machine              │
│  - Deduplication (FEN hash)                                      │
│  - Request throttling                                            │
│  - Feedback state: IDLE | REQUESTING | SHOWING | MOVE_PLAYED    │
└───────────────────────────┬─────────────────────────────────────┘
                            │ 2. AnalyzeRequest (WSS)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                       SERVER (Node.js)                           │
│  WebSocket Handler → Engine Pool Manager → Analyze Pipeline     │
│                                                                  │
│  ┌────────────┐   Queue-based   ┌─────────────────────────┐    │
│  │ Request    │   distribution   │ Engine Pool             │    │
│  │ Queue      │◄────────────────►│ - Min: 1, Max: 4        │    │
│  │            │                  │ - Auto-scale on demand  │    │
│  └────────────┘                  │ - Health checks         │    │
│                                   │ - Cooldown restarts     │    │
│                                   └──────────┬──────────────┘    │
│                                              │                   │
│                                              ▼                   │
│                         ┌────────────────────────────────┐      │
│                         │   DUAL-PHASE PIPELINE          │      │
│                         │                                │      │
│                         │  ┌─────────────────────────┐   │      │
│                         │  │ Phase A: ACCURACY REVIEW│   │      │
│                         │  │ - Last N moves          │   │      │
│                         │  │ - Full strength         │   │      │
│                         │  │ - MultiPV=2             │   │      │
│                         │  │ - 80ms/position         │   │      │
│                         │  └──────────┬──────────────┘   │      │
│                         │             │                  │      │
│                         │  ┌──────────▼──────────────┐   │      │
│                         │  │ Phase B: RESET          │   │      │
│                         │  │ - ucinewgame            │   │      │
│                         │  │ - Clear hash tables     │   │      │
│                         │  └──────────┬──────────────┘   │      │
│                         │             │                  │      │
│                         │  ┌──────────▼──────────────┐   │      │
│                         │  │ Phase C: SUGGESTIONS    │   │      │
│                         │  │ - ELO-tuned             │   │      │
│                         │  │ - Personality-aware     │   │      │
│                         │  │ - MultiPV=1-8           │   │      │
│                         │  │ - 100-3000ms budget     │   │      │
│                         │  └──────────┬──────────────┘   │      │
│                         │             │                  │      │
│                         └─────────────┼──────────────────┘      │
│                                       │                         │
│  ┌────────────────────────────────────▼───────────────────┐    │
│  │  KOMODO DRAGON 3.3 (UCI)                               │    │
│  │  - Classic Alpha-Beta + Komodo MCTS Hybrid             │    │
│  │  - 8 Personalities (Default, Aggressive, Human, ...)   │    │
│  │  - ELO Limit Strength (500-3500)                       │    │
│  │  - MultiPV support (1-500)                             │    │
│  │  - Hash: 32-256MB (ELO-scaled)                         │    │
│  └────────────────────────────────────────────────────────┘    │
└───────────────────────────┬─────────────────────────────────────┘
                            │ 3. AnalyzeResultResponse
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EXTENSION CLIENT (UI)                         │
│  - Display rolling accuracy (last 10 moves)                      │
│  - Show 1-3 suggestions with labels (Best, Safe, Risky, Alt)    │
│  - Track played move vs suggestions                             │
│  - Cache accuracy for incremental updates                       │
└─────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibilities | Location |
|-----------|-----------------|----------|
| **Content Script** | DOM observation, position extraction, move detection | `extension/src/content/` |
| **WebSocket Client** | Connection management, request/response correlation | `extension/src/content/websocket-client.ts` |
| **Feedback State Machine** | Request lifecycle, deduplication, caching | `extension/src/domain/analysis/feedback-types.ts` |
| **WebSocket Server** | Request routing, auth validation, metrics | `server/src/index.ts` |
| **Engine Pool** | Resource management, auto-scaling, health checks | `server/src/engine-pool.ts` |
| **Analyze Pipeline** | Dual-phase orchestration, ELO tuning | `server/src/analyze-pipeline.ts` |
| **Chess Engine** | UCI protocol wrapper, Komodo Dragon interface | `server/src/engine.ts` |
| **Stats Calculator** | Accuracy, classification, ACPL, ELO estimation | `server/src/stats-calculator.ts` |
| **UCI Classifier** | Chess.com-style move categorization | `server/src/uci-helpers-classify.ts` |

---

## Request/Response Contracts

### AnalyzeRequest (Client → Server)

**Schema:**

```typescript
interface AnalyzeRequest {
  type: 'analyze'
  requestId?: string  // Optional correlation ID
  payload: {
    // === REQUIRED: Position Data ===
    movesUci: string[]  // Full game history in UCI notation
                        // e.g., ["e2e4", "e7e5", "g1f3", "b8c6"]

    // === OPTIONAL: Position Context ===
    fen?: string        // Current position FEN (fallback if UCI fails)
    sideToMove?: 'w' | 'b'  // Side to move (computed from movesUci if absent)

    // === OPTIONAL: Game Metadata ===
    gameId?: string     // Chess.com/Lichess game ID (for logging)
    site?: 'chesscom' | 'lichess'  // Platform (for site-specific logic)
    playerElo?: number  // Opponent ELO (for future analysis context)

    // === REQUIRED: Review Settings ===
    review: {
      lastMoves: number  // How many full moves to review (default: 10)
                         // lastMoves=10 → last 20 plies
    }

    // === REQUIRED: User Settings ===
    user: {
      targetElo: number          // 500-2500 (drives search depth)
      personality: Personality   // See Personality enum
      multiPV: number            // 1-8 (how many suggestions to return)
      disableLimitStrength?: boolean  // true = ignore ELO limit (advanced)
    }
  }
}

// Personality Types (Komodo Dragon personalities)
type Personality =
  | 'Default'      // Balanced, universal
  | 'Aggressive'   // Tactical, risky
  | 'Defensive'    // Solid, prophylactic
  | 'Active'       // Dynamic piece play
  | 'Positional'   // Strategic, structural
  | 'Endgame'      // Technical precision
  | 'Beginner'     // Simple, clear
  | 'Human'        // Human-like move selection
```

**Example Request:**

```json
{
  "type": "analyze",
  "requestId": "req_1738267800123_abc123",
  "payload": {
    "movesUci": ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5"],
    "fen": "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
    "sideToMove": "w",
    "gameId": "chesscom_12345678",
    "site": "chesscom",
    "review": {
      "lastMoves": 10
    },
    "user": {
      "targetElo": 1500,
      "personality": "Default",
      "multiPV": 3,
      "disableLimitStrength": false
    }
  }
}
```

---

### AnalyzeResultResponse (Server → Client)

**Schema:**

```typescript
interface AnalyzeResultResponse {
  type: 'analyze_result'
  version: string  // Protocol version (currently '1.0')
  payload: {
    // === ACCURACY ANALYSIS (Phase A Results) ===
    accuracy: AccuracyPayload

    // === SUGGESTIONS (Phase C Results) ===
    suggestions: SuggestionsPayload
  }
  meta: {
    engine: string  // e.g., "KomodoDragon"
    settingsUsed: {
      review: ReviewSettings     // Actual Phase A config
      suggestion: SuggestionSettings  // Actual Phase C config
    }
    timings: {
      reviewMs: number      // Phase A duration
      suggestionMs: number  // Phase C duration
      totalMs: number       // End-to-end time
    }
  }
}

// === ACCURACY PAYLOAD ===
interface AccuracyPayload {
  method: 'win_percent_loss'  // Primary metric method
  window: {
    lastMoves: number        // Requested move count
    lastPlies: number        // Actual plies analyzed (lastMoves * 2)
    analyzedPlies: number    // Successfully analyzed (may be < lastPlies)
    startPlyIndex: number    // Starting ply index (0-based)
  }
  overall: number  // Overall accuracy 0-100 (average of per-ply accuracies)

  // === MOVE DISTRIBUTION SUMMARY ===
  summary: {
    brilliant: number    // Count of brilliant moves
    great: number        // Count of great moves
    best: number         // Count of best moves
    excellent: number    // Count of excellent moves
    good: number         // Count of good moves
    book: number         // Count of book moves (opening theory)
    inaccuracy: number   // Count of inaccuracies
    mistake: number      // Count of mistakes
    blunder: number      // Count of blunders
    missed: number       // Count of forced mates missed
  }

  // === PER-MOVE BREAKDOWN ===
  perPly: AccuracyPly[]  // Detailed per-ply analysis
}

interface AccuracyPly {
  // === MOVE IDENTIFICATION ===
  plyIndex: number       // 0-based ply index from game start
  moveNumber: number     // Move number (1, 2, 3, ...)
  side: 'white' | 'black'  // Side that played this move

  // === MOVE NOTATION ===
  playedMove: string     // UCI notation (e.g., "e2e4")
  bestMove: string       // Best move UCI (from engine)

  // === EVALUATION (White POV) ===
  evaluation: {
    bestAfter: EngineScore    // Eval after best move (White POV)
    playedAfter: EngineScore  // Eval after played move (White POV)
  }

  // === LOSS METRICS ===
  loss: {
    cp?: number          // Centipawn loss (optional, for legacy)
    winPercent?: number  // Win% loss (PRIMARY, 0-100)
  }

  // === QUALITY METRICS ===
  accuracy: number  // Individual move accuracy 0-100
  classification: MoveClassification

  // === CONTEXT DATA ===
  extras: {
    gapWin?: number         // Gap to 2nd-best move (win%)
    gapCp?: number          // Gap to 2nd-best move (cp)
    swingWin?: number       // Eval swing from previous position
    materialDelta?: number  // Material change (captures)
    secondBestMove?: string // 2nd-best move UCI
  }

  // === FLAGS ===
  flags: {
    isMateMiss?: boolean          // Missed forced mate
    allowsImmediateMate?: boolean // Allows mate-in-1 for opponent
  }
}

type MoveClassification =
  | 'Brilliant'   // Sacrifice + winning (or only move that wins)
  | 'Great'       // Turning point or material sac with advantage
  | 'Best'        // 0-0.2% win loss
  | 'Excellent'   // 0.2-1% win loss
  | 'Good'        // 1-3% win loss
  | 'Inaccuracy'  // 3-8% win loss
  | 'Mistake'     // 8-20% win loss
  | 'Blunder'     // >20% win loss

interface EngineScore {
  type: 'cp' | 'mate'
  value: number   // cp: centipawns (White POV), mate: moves to mate (+ for White)
  pov: 'white'    // Always White perspective
}

// === SUGGESTIONS PAYLOAD ===
interface SuggestionsPayload {
  // === CONTEXT ===
  context: {
    fen: string            // Current position FEN
    sideToMove: 'w' | 'b'  // Side to move
    plyIndex: number       // Current ply index
  }

  // === USER SETTINGS (echo) ===
  userSettings: {
    targetElo: number
    personality: Personality
    multiPV: number
  }

  // === ENGINE CONFIG USED ===
  computeSettings: {
    hashMB: number      // Hash table size used
    movetimeMs: number  // Search time budget used
    warmup: {
      method: 'history' | 'fen'  // How position was set
      pliesSent?: number          // UCI history length (if method=history)
    }
  }

  // === SUGGESTION MOVES ===
  suggestions: SuggestionMove[]  // Ordered by quality (index 0 = best)
  chosenIndex: number  // Recommended move index (typically 0)
}

interface SuggestionMove {
  // === MOVE IDENTIFICATION ===
  index: number      // MultiPV rank (1..N, from engine)
  move: string       // UCI notation (e.g., "e2e4")

  // === EVALUATION ===
  score: EngineScore  // Position eval after this move (White POV)
  pv: string[]        // Principal variation (UCI moves)

  // === MOVE FLAGS ===
  flags: {
    isMate: boolean             // Move delivers checkmate
    isCheck: boolean            // Move gives check
    isCapture: boolean          // Move captures
    capturedPiece?: string      // Piece captured (e.g., "q", "r")
    isPromotion: boolean        // Move is pawn promotion
    promotionPiece?: string     // Promoted to (e.g., "q", "r")
  }

  // === SAFETY ANALYSIS ===
  safety: {
    filtered: boolean  // Was this filtered out by safety checks?
    blunderRisk: 'low' | 'medium' | 'high'  // Eval delta vs best
    mateThreat?: boolean  // Allows opponent mate threat
  }

  // === UI LABEL (optional) ===
  label?: SuggestionLabel
}

type SuggestionLabel =
  | 'Best'   // Index 0, highest eval
  | 'Safe'   // Low blunder risk, small eval delta
  | 'Risky'  // High blunder risk, tactical
  | 'Human'  // Personality=Human, human-like move
  | 'Alt'    // Alternative candidate
  | 'Check'  // Gives check
  | 'Mate'   // Delivers mate
```

**Example Response:**

```json
{
  "type": "analyze_result",
  "version": "1.0",
  "payload": {
    "accuracy": {
      "method": "win_percent_loss",
      "window": {
        "lastMoves": 10,
        "lastPlies": 20,
        "analyzedPlies": 18,
        "startPlyIndex": 2
      },
      "overall": 87.3,
      "summary": {
        "brilliant": 0,
        "great": 1,
        "best": 8,
        "excellent": 5,
        "good": 3,
        "book": 2,
        "inaccuracy": 1,
        "mistake": 0,
        "blunder": 0,
        "missed": 0
      },
      "perPly": [/* ... */]
    },
    "suggestions": {
      "context": {
        "fen": "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
        "sideToMove": "w",
        "plyIndex": 6
      },
      "userSettings": {
        "targetElo": 1500,
        "personality": "Default",
        "multiPV": 3
      },
      "computeSettings": {
        "hashMB": 128,
        "movetimeMs": 1000,
        "warmup": {
          "method": "history",
          "pliesSent": 6
        }
      },
      "suggestions": [
        {
          "index": 1,
          "move": "d2d3",
          "score": { "type": "cp", "value": 18, "pov": "white" },
          "pv": ["d2d3", "g8f6", "b1c3"],
          "flags": {
            "isMate": false,
            "isCheck": false,
            "isCapture": false,
            "isPromotion": false
          },
          "safety": {
            "filtered": false,
            "blunderRisk": "low"
          },
          "label": "Best"
        },
        {
          "index": 2,
          "move": "c2c3",
          "score": { "type": "cp", "value": 12, "pov": "white" },
          "pv": ["c2c3", "g8f6", "d2d4"],
          "flags": {
            "isMate": false,
            "isCheck": false,
            "isCapture": false,
            "isPromotion": false
          },
          "safety": {
            "filtered": false,
            "blunderRisk": "low"
          },
          "label": "Safe"
        },
        {
          "index": 3,
          "move": "f3g5",
          "score": { "type": "cp", "value": -8, "pov": "white" },
          "pv": ["f3g5", "d8f6", "g5f7"],
          "flags": {
            "isMate": false,
            "isCheck": false,
            "isCapture": false,
            "isPromotion": false
          },
          "safety": {
            "filtered": false,
            "blunderRisk": "medium"
          },
          "label": "Risky"
        }
      ],
      "chosenIndex": 0
    }
  },
  "meta": {
    "engine": "KomodoDragon",
    "settingsUsed": {
      "review": {
        "hashMB": 256,
        "movetimeMs": 80,
        "eloLimit": 3500,
        "personality": "Default",
        "multiPV": 2
      },
      "suggestion": {
        "hashMB": 128,
        "movetimeMs": 1000,
        "eloLimit": 1500,
        "personality": "Default",
        "multiPV": 3
      }
    },
    "timings": {
      "reviewMs": 1450,
      "suggestionMs": 1100,
      "totalMs": 2650
    }
  }
}
```

---

## Suggestion Pipeline (Phase C)

**Goal:** Generate 1-8 user-facing move suggestions tailored to the player's ELO and personality, without contamination from prior full-strength analysis.

### Step-by-Step Flow

```
┌──────────────────────────────────────────────────────────────────┐
│ PHASE C: USER-MODE SUGGESTIONS                                   │
└──────────────────────────────────────────────────────────────────┘

Input: AnalyzeRequest.payload.{movesUci, user.{targetElo, personality, multiPV}}
Output: SuggestionsPayload

───────────────────────────────────────────────────────────────────

STEP 1: Acquire Engine from Pool
  ├─ Call: enginePool.getEngineForDirectUse()
  ├─ Behavior: Blocks until engine available OR scales up if queue ≥ 2
  └─ Timeout: 30s (reject request if no engine available)

───────────────────────────────────────────────────────────────────

STEP 2: Look Up ELO Band Configuration
  ├─ Function: getEloBandSettings(targetElo)
  ├─ Input: user.targetElo (500-2500)
  ├─ Output: EloBandConfig
  │   ├─ hashMB: 32-256
  │   ├─ movetimeMs: 100-3000
  │   ├─ nodesMain: 30k-2.5M (reference depth)
  │   ├─ nodesCand: 3k-50k (candidate eval)
  │   ├─ windowCp: 120-20 (acceptance window)
  │   └─ tempCp: 60-15 (selection temperature)
  └─ Override: If user.disableLimitStrength=true AND targetElo≥2000,
               use full-strength config (hashMB=256, movetimeMs=3000)

───────────────────────────────────────────────────────────────────

STEP 3: Configure Engine for User Mode
  ├─ Send UCI Commands:
  │   ├─ setoption name Hash value {hashMB}
  │   ├─ setoption name UCI_LimitStrength value true  // Unless disabled
  │   ├─ setoption name UCI_Elo value {targetElo}
  │   ├─ setoption name Personality value {personality}
  │   ├─ setoption name MultiPV value {multiPV}
  │   └─ setoption name Threads value 2  // Or server config
  └─ Note: Engine caches personality/ELO to avoid redundant UCI commands

───────────────────────────────────────────────────────────────────

STEP 4: Synchronize Engine to Current Position
  ├─ Method A (Preferred): Feed Move History
  │   ├─ Command: position startpos moves {movesUci.join(' ')}
  │   ├─ Why: Allows engine to use transposition tables, opening book
  │   └─ Limitation: Fails if movesUci contains illegal moves
  │
  └─ Method B (Fallback): Set FEN Directly
      ├─ Command: position fen {fen}
      ├─ Why: Robust fallback for invalid UCI or FEN-only requests
      └─ Limitation: Loses move history context (no opening book)

───────────────────────────────────────────────────────────────────

STEP 5: Run Search with Time/Nodes Budget
  ├─ Command: go movetime {movetimeMs}
  │   ├─ Alternative: go nodes {nodesMain}  // Less common
  │   └─ No depth limit (engine decides based on time)
  │
  ├─ Engine Behavior:
  │   ├─ Komodo Dragon uses hybrid Alpha-Beta + MCTS internally
  │   ├─ MultiPV=N returns top N candidates with scores
  │   ├─ Personalities influence eval function and move selection
  │   └─ ELO limit reduces search depth and introduces inaccuracies
  │
  └─ Timeout: movetimeMs + 500ms grace period (kill if hangs)

───────────────────────────────────────────────────────────────────

STEP 6: Parse Engine Output
  ├─ Wait for: bestmove {move} ponder {ponderMove}
  ├─ Collect all info lines during search:
  │   ├─ info depth {d} seldepth {sd} multipv {n} score {cp|mate} {val}
  │   ├─ ... nodes {nodes} nps {nps} time {time} pv {move1 move2 ...}
  │   └─ Keep only LAST info line per multipv index (engine refines)
  │
  └─ Extract per MultiPV line:
      ├─ move: First move in PV
      ├─ score: {type: 'cp'|'mate', value: number, pov: 'white'}
      ├─ pv: Principal variation (move sequence)
      └─ index: MultiPV rank (1..N)

───────────────────────────────────────────────────────────────────

STEP 7: Normalize Scores to White POV
  ├─ Input: Raw engine score (side-to-move POV)
  ├─ If sideToMove === 'black': negate score
  ├─ Output: EngineScore with pov='white'
  └─ Example: Black to move, engine says +50cp → White POV = -50cp

───────────────────────────────────────────────────────────────────

STEP 8: Enrich Each Suggestion with Metadata
  ├─ For each MultiPV line:
  │   ├─ Parse move with chess.js to extract:
  │   │   ├─ isMate, isCheck, isCapture, capturedPiece
  │   │   └─ isPromotion, promotionPiece
  │   │
  │   ├─ Compute safety metrics:
  │   │   ├─ blunderRisk: Compare score to best move
  │   │   │   ├─ Delta < 30cp: 'low'
  │   │   │   ├─ Delta 30-100cp: 'medium'
  │   │   │   └─ Delta > 100cp: 'high'
  │   │   └─ mateThreat: Check if opponent has mate-in-1 after move
  │   │
  │   └─ Assign label:
  │       ├─ index=1: 'Best'
  │       ├─ isMate=true: 'Mate'
  │       ├─ isCheck=true: 'Check'
  │       ├─ blunderRisk='low': 'Safe'
  │       ├─ blunderRisk='high': 'Risky'
  │       ├─ personality='Human': 'Human'
  │       └─ Default: 'Alt'
  │
  └─ Filter out (optional):
      ├─ Moves with blunderRisk='high' AND score delta > 200cp
      └─ Moves allowing immediate mate (unless mate defense)

───────────────────────────────────────────────────────────────────

STEP 9: Build SuggestionsPayload
  ├─ context: {fen, sideToMove, plyIndex}
  ├─ userSettings: {targetElo, personality, multiPV}
  ├─ computeSettings: {hashMB, movetimeMs, warmup}
  ├─ suggestions: SuggestionMove[] (sorted by score, best first)
  └─ chosenIndex: 0 (recommend top move)

───────────────────────────────────────────────────────────────────

STEP 10: Release Engine to Pool
  ├─ Call: enginePool.releaseEngine(engine)
  ├─ Behavior: Returns engine to available pool OR processes queued request
  └─ Scale-down: Async monitor terminates idle engines after 60s

───────────────────────────────────────────────────────────────────

END PHASE C
```

### Pseudo-Code Implementation

```typescript
// FILE: server/src/analyze-pipeline.ts

async function generateSuggestions(
  engine: ChessEngine,
  request: AnalyzeRequest
): Promise<SuggestionsPayload> {

  const { movesUci, user } = request.payload
  const { targetElo, personality, multiPV, disableLimitStrength } = user

  // ─────────────────────────────────────────────────────────────
  // STEP 2: Get ELO Band Config
  // ─────────────────────────────────────────────────────────────
  const eloBand = getEloBandSettings(targetElo)
  let hashMB = eloBand.hashMB
  let movetimeMs = eloBand.movetimeMs

  // Override for advanced players
  if (disableLimitStrength && targetElo >= 2000) {
    hashMB = 256
    movetimeMs = 3000
  }

  // ─────────────────────────────────────────────────────────────
  // STEP 3: Configure Engine
  // ─────────────────────────────────────────────────────────────
  await engine.setOption('Hash', hashMB)
  await engine.setOption('MultiPV', multiPV)

  if (disableLimitStrength) {
    await engine.setOption('UCI_LimitStrength', false)
  } else {
    await engine.setOption('UCI_LimitStrength', true)
    await engine.setOption('UCI_Elo', targetElo)
  }

  // Set personality (engine caches internally to avoid redundant calls)
  await engine.setPersonality(personality)

  // ─────────────────────────────────────────────────────────────
  // STEP 4: Sync Position
  // ─────────────────────────────────────────────────────────────
  let warmupMethod: 'history' | 'fen'
  let pliesSent: number | undefined

  try {
    // Preferred: Feed move history
    await engine.sendCommand(`position startpos moves ${movesUci.join(' ')}`)
    warmupMethod = 'history'
    pliesSent = movesUci.length
  } catch (err) {
    // Fallback: Set FEN directly
    const fen = request.payload.fen || computeFenFromMoves(movesUci)
    await engine.sendCommand(`position fen ${fen}`)
    warmupMethod = 'fen'
  }

  // ─────────────────────────────────────────────────────────────
  // STEP 5 & 6: Run Search and Parse Output
  // ─────────────────────────────────────────────────────────────
  const analysisResult = await engine.analyze({
    command: `go movetime ${movetimeMs}`,
    timeout: movetimeMs + 500
  })

  // analysisResult.multiPvLines: Map<number, InfoLine>
  // InfoLine: { move, score, pv, depth, nodes }

  const rawSuggestions = Array.from(analysisResult.multiPvLines.values())
    .sort((a, b) => a.index - b.index)  // Sort by MultiPV index

  // ─────────────────────────────────────────────────────────────
  // STEP 7: Normalize Scores to White POV
  // ─────────────────────────────────────────────────────────────
  const sideToMove = request.payload.sideToMove ||
                     (movesUci.length % 2 === 0 ? 'w' : 'b')

  const normalizedSuggestions = rawSuggestions.map(line => {
    let score = line.score

    // Negate if Black to move
    if (sideToMove === 'b') {
      score = {
        ...score,
        value: -score.value
      }
    }

    return {
      ...line,
      score: { ...score, pov: 'white' }
    }
  })

  // ─────────────────────────────────────────────────────────────
  // STEP 8: Enrich with Metadata
  // ─────────────────────────────────────────────────────────────
  const chess = new Chess()  // chess.js for move parsing
  movesUci.forEach(m => chess.move(m))  // Replay to current position

  const bestScore = normalizedSuggestions[0]?.score

  const enrichedSuggestions: SuggestionMove[] = normalizedSuggestions.map((line, idx) => {
    // Parse move flags
    const moveObj = chess.move(line.move)
    const flags = {
      isMate: chess.isCheckmate(),
      isCheck: chess.isCheck(),
      isCapture: moveObj.captured !== undefined,
      capturedPiece: moveObj.captured,
      isPromotion: moveObj.promotion !== undefined,
      promotionPiece: moveObj.promotion
    }
    chess.undo()  // Undo to keep position consistent

    // Compute safety
    const scoreDelta = Math.abs(
      getScoreValue(line.score) - getScoreValue(bestScore)
    )

    const blunderRisk =
      scoreDelta < 30 ? 'low' :
      scoreDelta < 100 ? 'medium' :
      'high'

    // Assign label
    let label: SuggestionLabel | undefined
    if (idx === 0) label = 'Best'
    else if (flags.isMate) label = 'Mate'
    else if (flags.isCheck) label = 'Check'
    else if (blunderRisk === 'low') label = 'Safe'
    else if (blunderRisk === 'high') label = 'Risky'
    else if (personality === 'Human') label = 'Human'
    else label = 'Alt'

    return {
      index: line.index,
      move: line.move,
      score: line.score,
      pv: line.pv,
      flags,
      safety: {
        filtered: false,
        blunderRisk,
        mateThreat: checkMateThreat(chess, line.move)
      },
      label
    }
  })

  // ─────────────────────────────────────────────────────────────
  // STEP 9: Build Response
  // ─────────────────────────────────────────────────────────────
  const currentFen = chess.fen()

  return {
    context: {
      fen: currentFen,
      sideToMove,
      plyIndex: movesUci.length
    },
    userSettings: { targetElo, personality, multiPV },
    computeSettings: {
      hashMB,
      movetimeMs,
      warmup: {
        method: warmupMethod,
        pliesSent
      }
    },
    suggestions: enrichedSuggestions,
    chosenIndex: 0
  }
}

// Helper: Convert EngineScore to comparable number
function getScoreValue(score: EngineScore): number {
  if (score.type === 'mate') {
    return score.value > 0 ? 10000 : -10000  // Mate is infinite
  }
  return score.value  // Centipawns
}

// Helper: Check if move allows mate-in-1 for opponent
function checkMateThreat(chess: Chess, move: string): boolean {
  chess.move(move)
  const opponentMoves = chess.moves()
  for (const oppMove of opponentMoves) {
    chess.move(oppMove)
    if (chess.isCheckmate()) {
      chess.undo()
      chess.undo()
      return true
    }
    chess.undo()
  }
  chess.undo()
  return false
}
```

---

## Stats Pipeline (Phase A)

**Goal:** Compute per-move accuracy metrics and classifications for the last N moves, using full engine strength to establish ground truth.

### Step-by-Step Flow

```
┌──────────────────────────────────────────────────────────────────┐
│ PHASE A: ACCURACY REVIEW (Full-Strength Analysis)                │
└──────────────────────────────────────────────────────────────────┘

Input: AnalyzeRequest.payload.{movesUci, review.lastMoves}
Output: AccuracyPayload

───────────────────────────────────────────────────────────────────

STEP 1: Determine Analysis Window
  ├─ lastMoves = request.payload.review.lastMoves (default: 10)
  ├─ lastPlies = lastMoves * 2  // Each move = 2 plies (White + Black)
  ├─ totalPlies = movesUci.length
  ├─ startPlyIndex = max(0, totalPlies - lastPlies)
  └─ analyzedPlies = totalPlies - startPlyIndex  // Actual count to analyze

───────────────────────────────────────────────────────────────────

STEP 2: Configure Engine for Full-Strength Analysis
  ├─ Send UCI Commands:
  │   ├─ setoption name Hash value 256
  │   ├─ setoption name UCI_LimitStrength value false  // Full strength!
  │   ├─ setoption name UCI_Elo value 3500  // Max ELO
  │   ├─ setoption name Personality value Default
  │   ├─ setoption name MultiPV value 2  // Need 2nd-best for gap calc
  │   └─ setoption name Threads value 2
  └─ Note: Phase A always uses fixed config (not user-dependent)

───────────────────────────────────────────────────────────────────

STEP 3: Initialize Stats Accumulator
  ├─ Create empty array: perPly: AccuracyPly[] = []
  ├─ Track counts: summary = { best: 0, excellent: 0, ... }
  └─ Track running accuracy sum for overall calculation

───────────────────────────────────────────────────────────────────

STEP 4: Loop Through Each Ply in Window
  FOR plyIndex FROM startPlyIndex TO (totalPlies - 1):

    ┌──────────────────────────────────────────────────────────────┐
    │ STEP 4.1: Reconstruct Position BEFORE Move                   │
    └──────────────────────────────────────────────────────────────┘
    ├─ Extract move history up to (but not including) current ply
    ├─ movesBeforePly = movesUci.slice(0, plyIndex)
    └─ Set position: position startpos moves {movesBeforePly.join(' ')}

    ┌──────────────────────────────────────────────────────────────┐
    │ STEP 4.2: Get Evaluation BEFORE Played Move                  │
    └──────────────────────────────────────────────────────────────┘
    ├─ Run search: go movetime 80
    ├─ Timeout: 80ms + 200ms grace
    ├─ Extract:
    │   ├─ evalBefore: Score at current position (White POV)
    │   ├─ bestMove: Top engine recommendation (MultiPV=1)
    │   └─ secondBestMove: 2nd-best move (MultiPV=2)
    └─ Normalize: Convert score to White POV (negate if Black's turn)

    ┌──────────────────────────────────────────────────────────────┐
    │ STEP 4.3: Get Evaluation AFTER Played Move                   │
    └──────────────────────────────────────────────────────────────┘
    ├─ playedMove = movesUci[plyIndex]
    ├─ Apply move: position startpos moves {movesUci.slice(0, plyIndex+1).join(' ')}
    ├─ Run search: go movetime 80
    ├─ Extract:
    │   └─ evalAfterPlayed: Score after played move (White POV)
    └─ Normalize: Convert to White POV

    ┌──────────────────────────────────────────────────────────────┐
    │ STEP 4.4: Get Evaluation AFTER Best Move                     │
    └──────────────────────────────────────────────────────────────┘
    ├─ If playedMove === bestMove:
    │   └─ evalAfterBest = evalAfterPlayed (skip redundant search)
    ├─ Else:
    │   ├─ Apply best move: position startpos moves {..., bestMove}
    │   ├─ Run search: go movetime 80
    │   └─ Extract: evalAfterBest (White POV)

    ┌──────────────────────────────────────────────────────────────┐
    │ STEP 4.5: Compute Loss Metrics                               │
    └──────────────────────────────────────────────────────────────┘
    ├─ Win% Conversion:
    │   ├─ Function: cpToWinPercent(cp) = 50 + 50 * (2/(1+e^(-0.00368*cp)) - 1)
    │   ├─ winBefore = cpToWinPercent(evalBefore)
    │   ├─ winAfterBest = cpToWinPercent(evalAfterBest)
    │   └─ winAfterPlayed = cpToWinPercent(evalAfterPlayed)
    │
    ├─ Loss Win%:
    │   ├─ Adjust for side: If Black's turn, flip perspective
    │   │   ├─ winBeforeSide = Black ? (100 - winBefore) : winBefore
    │   │   ├─ winAfterBestSide = Black ? (100 - winAfterBest) : winAfterBest
    │   │   └─ winAfterPlayedSide = Black ? (100 - winAfterPlayed) : winAfterPlayed
    │   ├─ lossWinPercent = winAfterBestSide - winAfterPlayedSide
    │   └─ Clamp: max(0, lossWinPercent)  // Can't be negative
    │
    └─ Centipawn Loss (legacy):
        ├─ cpLoss = evalAfterBest - evalAfterPlayed  // White POV
        └─ Adjust for side: If Black's turn, negate

    ┌──────────────────────────────────────────────────────────────┐
    │ STEP 4.6: Compute Gap Metrics                                │
    └──────────────────────────────────────────────────────────────┘
    ├─ gapCp = evalBestMove - evalSecondBestMove (MultiPV gap)
    ├─ gapWin = cpToWinPercent(evalBestMove) - cpToWinPercent(evalSecondBest)
    └─ swingWin = abs(winAfterPlayed - winBefore)  // Position swing

    ┌──────────────────────────────────────────────────────────────┐
    │ STEP 4.7: Classify Move                                      │
    └──────────────────────────────────────────────────────────────┘
    ├─ Use classification function (Chess.com-style):
    │   ├─ Input: lossWinPercent, gapWin, swingWin, materialDelta
    │   └─ Output: Classification ('Best', 'Excellent', ..., 'Blunder')
    │
    ├─ Base thresholds:
    │   ├─ Best: 0-0.2% loss
    │   ├─ Excellent: 0.2-1% loss
    │   ├─ Good: 1-3% loss
    │   ├─ Inaccuracy: 3-8% loss
    │   ├─ Mistake: 8-20% loss
    │   └─ Blunder: >20% loss
    │
    ├─ Upgrades:
    │   ├─ Great: If gapWin > 3% OR (materialDelta < 0 AND winning)
    │   └─ Brilliant: If sacrifice AND winning move
    │
    └─ Mate handling:
        ├─ If playedMove allows mate-in-1: Override to 'Blunder'
        └─ If missed forced mate: Override to 'Blunder', set isMateMiss

    ┌──────────────────────────────────────────────────────────────┐
    │ STEP 4.8: Compute Move Accuracy                              │
    └──────────────────────────────────────────────────────────────┘
    ├─ Formula: accuracy = 103.17 * e^(-0.04354 * lossWinPercent) - 3.17 + 1
    ├─ Clamp: min(100, max(0, accuracy))
    └─ This gives 0-100 scale aligned with human perception

    ┌──────────────────────────────────────────────────────────────┐
    │ STEP 4.9: Build AccuracyPly Record                           │
    └──────────────────────────────────────────────────────────────┘
    const ply: AccuracyPly = {
      plyIndex,
      moveNumber: Math.floor(plyIndex / 2) + 1,
      side: plyIndex % 2 === 0 ? 'white' : 'black',
      playedMove,
      bestMove,
      evaluation: {
        bestAfter: { type: 'cp', value: evalAfterBest, pov: 'white' },
        playedAfter: { type: 'cp', value: evalAfterPlayed, pov: 'white' }
      },
      loss: {
        cp: cpLoss,
        winPercent: lossWinPercent
      },
      accuracy,
      classification,
      extras: {
        gapWin,
        gapCp,
        swingWin,
        materialDelta,
        secondBestMove
      },
      flags: {
        isMateMiss: missedForcedMate,
        allowsImmediateMate: allowsMateInOne
      }
    }

    ┌──────────────────────────────────────────────────────────────┐
    │ STEP 4.10: Update Accumulators                               │
    └──────────────────────────────────────────────────────────────┘
    ├─ perPly.push(ply)
    ├─ summary[classification]++
    └─ accuracySum += accuracy

  END FOR LOOP

───────────────────────────────────────────────────────────────────

STEP 5: Compute Overall Accuracy
  ├─ overallAccuracy = accuracySum / perPly.length
  └─ Clamp: min(100, max(0, overallAccuracy))

───────────────────────────────────────────────────────────────────

STEP 6: Build AccuracyPayload
  return {
    method: 'win_percent_loss',
    window: {
      lastMoves,
      lastPlies,
      analyzedPlies: perPly.length,
      startPlyIndex
    },
    overall: overallAccuracy,
    summary,
    perPly
  }

───────────────────────────────────────────────────────────────────

END PHASE A
```

### Pseudo-Code Implementation

```typescript
// FILE: server/src/analyze-pipeline.ts

async function computeAccuracy(
  engine: ChessEngine,
  request: AnalyzeRequest
): Promise<AccuracyPayload> {

  const { movesUci, review } = request.payload
  const lastMoves = review.lastMoves || 10

  // ─────────────────────────────────────────────────────────────
  // STEP 1: Determine Analysis Window
  // ─────────────────────────────────────────────────────────────
  const lastPlies = lastMoves * 2
  const totalPlies = movesUci.length
  const startPlyIndex = Math.max(0, totalPlies - lastPlies)
  const analyzedPlies = totalPlies - startPlyIndex

  // ─────────────────────────────────────────────────────────────
  // STEP 2: Configure Engine for Full-Strength
  // ─────────────────────────────────────────────────────────────
  await engine.setOption('Hash', 256)
  await engine.setOption('MultiPV', 2)  // Need 2nd-best for gap
  await engine.setOption('UCI_LimitStrength', false)
  await engine.setOption('UCI_Elo', 3500)
  await engine.setPersonality('Default')

  // ─────────────────────────────────────────────────────────────
  // STEP 3: Initialize Accumulators
  // ─────────────────────────────────────────────────────────────
  const perPly: AccuracyPly[] = []
  const summary = {
    brilliant: 0, great: 0, best: 0, excellent: 0, good: 0,
    book: 0, inaccuracy: 0, mistake: 0, blunder: 0, missed: 0
  }
  let accuracySum = 0

  // ─────────────────────────────────────────────────────────────
  // STEP 4: Loop Through Each Ply
  // ─────────────────────────────────────────────────────────────
  for (let plyIndex = startPlyIndex; plyIndex < totalPlies; plyIndex++) {
    const moveNumber = Math.floor(plyIndex / 2) + 1
    const side = plyIndex % 2 === 0 ? 'white' : 'black'
    const playedMove = movesUci[plyIndex]

    // ────────────────────────────────────────────────────────────
    // STEP 4.1: Position BEFORE move
    // ────────────────────────────────────────────────────────────
    const movesBeforePly = movesUci.slice(0, plyIndex)
    await engine.sendCommand(`position startpos moves ${movesBeforePly.join(' ')}`)

    // ────────────────────────────────────────────────────────────
    // STEP 4.2: Eval BEFORE move (get best move + 2nd-best)
    // ────────────────────────────────────────────────────────────
    const beforeResult = await engine.analyze({
      command: 'go movetime 80',
      timeout: 300
    })

    const bestMoveInfo = beforeResult.multiPvLines.get(1)!  // MultiPV=1
    const secondBestInfo = beforeResult.multiPvLines.get(2)  // MultiPV=2 (may be undefined)

    const bestMove = bestMoveInfo.move
    const secondBestMove = secondBestInfo?.move
    const evalBefore = normalizeScore(bestMoveInfo.score, side)

    // ────────────────────────────────────────────────────────────
    // STEP 4.3: Eval AFTER played move
    // ────────────────────────────────────────────────────────────
    await engine.sendCommand(`position startpos moves ${movesUci.slice(0, plyIndex+1).join(' ')}`)
    const playedResult = await engine.analyze({
      command: 'go movetime 80',
      timeout: 300
    })
    const evalAfterPlayed = normalizeScore(playedResult.multiPvLines.get(1)!.score, side)

    // ────────────────────────────────────────────────────────────
    // STEP 4.4: Eval AFTER best move (skip if played = best)
    // ────────────────────────────────────────────────────────────
    let evalAfterBest: number
    if (playedMove === bestMove) {
      evalAfterBest = evalAfterPlayed
    } else {
      const movesWithBest = [...movesBeforePly, bestMove]
      await engine.sendCommand(`position startpos moves ${movesWithBest.join(' ')}`)
      const bestResult = await engine.analyze({
        command: 'go movetime 80',
        timeout: 300
      })
      evalAfterBest = normalizeScore(bestResult.multiPvLines.get(1)!.score, side)
    }

    // ────────────────────────────────────────────────────────────
    // STEP 4.5: Compute Loss Metrics
    // ────────────────────────────────────────────────────────────
    const winBefore = cpToWinPercent(evalBefore)
    const winAfterBest = cpToWinPercent(evalAfterBest)
    const winAfterPlayed = cpToWinPercent(evalAfterPlayed)

    // Adjust for side-to-move
    const winBeforeSide = side === 'black' ? (100 - winBefore) : winBefore
    const winAfterBestSide = side === 'black' ? (100 - winAfterBest) : winAfterBest
    const winAfterPlayedSide = side === 'black' ? (100 - winAfterPlayed) : winAfterPlayed

    const lossWinPercent = Math.max(0, winAfterBestSide - winAfterPlayedSide)
    const cpLoss = side === 'black' ?
      -(evalAfterBest - evalAfterPlayed) :
      (evalAfterBest - evalAfterPlayed)

    // ────────────────────────────────────────────────────────────
    // STEP 4.6: Compute Gap Metrics
    // ────────────────────────────────────────────────────────────
    const gapCp = secondBestInfo ?
      (bestMoveInfo.score.value - secondBestInfo.score.value) : 0
    const gapWin = secondBestInfo ?
      (cpToWinPercent(bestMoveInfo.score.value) - cpToWinPercent(secondBestInfo.score.value)) : 0
    const swingWin = Math.abs(winAfterPlayed - winBefore)

    // Material delta (use chess.js)
    const chess = new Chess()
    movesBeforePly.forEach(m => chess.move(m))
    const materialBefore = getMaterialValue(chess)
    chess.move(playedMove)
    const materialAfter = getMaterialValue(chess)
    const materialDelta = materialAfter - materialBefore

    // ────────────────────────────────────────────────────────────
    // STEP 4.7: Classify Move
    // ────────────────────────────────────────────────────────────
    const classification = classifyMove({
      lossWinPercent,
      gapWin,
      swingWin,
      materialDelta,
      evalAfterPlayed,
      playedMove,
      bestMove
    })

    // ────────────────────────────────────────────────────────────
    // STEP 4.8: Compute Move Accuracy
    // ────────────────────────────────────────────────────────────
    const accuracy = Math.min(100, Math.max(0,
      103.17 * Math.exp(-0.04354 * lossWinPercent) - 3.17 + 1
    ))

    // ────────────────────────────────────────────────────────────
    // STEP 4.9: Build AccuracyPly Record
    // ────────────────────────────────────────────────────────────
    const ply: AccuracyPly = {
      plyIndex,
      moveNumber,
      side,
      playedMove,
      bestMove,
      evaluation: {
        bestAfter: { type: 'cp', value: evalAfterBest, pov: 'white' },
        playedAfter: { type: 'cp', value: evalAfterPlayed, pov: 'white' }
      },
      loss: { cp: cpLoss, winPercent: lossWinPercent },
      accuracy,
      classification,
      extras: {
        gapWin,
        gapCp,
        swingWin,
        materialDelta,
        secondBestMove
      },
      flags: {
        isMateMiss: false,  // TODO: Implement mate detection
        allowsImmediateMate: false
      }
    }

    // ────────────────────────────────────────────────────────────
    // STEP 4.10: Update Accumulators
    // ────────────────────────────────────────────────────────────
    perPly.push(ply)
    summary[classification.toLowerCase()]++
    accuracySum += accuracy
  }

  // ─────────────────────────────────────────────────────────────
  // STEP 5: Compute Overall Accuracy
  // ─────────────────────────────────────────────────────────────
  const overall = Math.min(100, Math.max(0, accuracySum / perPly.length))

  // ─────────────────────────────────────────────────────────────
  // STEP 6: Build Response
  // ─────────────────────────────────────────────────────────────
  return {
    method: 'win_percent_loss',
    window: {
      lastMoves,
      lastPlies,
      analyzedPlies: perPly.length,
      startPlyIndex
    },
    overall,
    summary,
    perPly
  }
}

// ═════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═════════════════════════════════════════════════════════════

function cpToWinPercent(cp: number): number {
  // Lichess formula
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368 * cp)) - 1)
}

function normalizeScore(score: EngineScore, side: 'white' | 'black'): number {
  let value = score.type === 'mate' ?
    (score.value > 0 ? 10000 : -10000) :
    score.value

  // Negate if Black's turn (engine gives side-to-move POV)
  if (side === 'black') {
    value = -value
  }

  return value
}

function getMaterialValue(chess: Chess): number {
  const values = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
  let material = 0

  for (const square of chess.SQUARES) {
    const piece = chess.get(square)
    if (piece) {
      const value = values[piece.type]
      material += piece.color === 'w' ? value : -value
    }
  }

  return material
}

function classifyMove(params: {
  lossWinPercent: number
  gapWin: number
  swingWin: number
  materialDelta: number
  evalAfterPlayed: number
  playedMove: string
  bestMove: string
}): MoveClassification {
  const { lossWinPercent, gapWin, materialDelta, evalAfterPlayed } = params

  // Base classification by loss
  let classification: MoveClassification
  if (lossWinPercent <= 0.2) classification = 'Best'
  else if (lossWinPercent <= 1) classification = 'Excellent'
  else if (lossWinPercent <= 3) classification = 'Good'
  else if (lossWinPercent <= 8) classification = 'Inaccuracy'
  else if (lossWinPercent <= 20) classification = 'Mistake'
  else classification = 'Blunder'

  // Upgrade to Great
  if (
    (classification === 'Best' || classification === 'Excellent') &&
    (gapWin > 3 || (materialDelta < 0 && evalAfterPlayed > 50))
  ) {
    classification = 'Great'
  }

  // Upgrade to Brilliant
  if (
    classification === 'Great' &&
    materialDelta < -3 &&  // Significant sacrifice
    evalAfterPlayed > 100  // Winning position
  ) {
    classification = 'Brilliant'
  }

  return classification
}
```

---

## Shared Data Model & Caching

### Cross-Phase Data Sharing

**Problem:** Phase A and Phase C analyze the same position, but with different engine configs. How do we avoid redundant computation and maintain consistency?

**Solution:** Limited sharing via request-scoped caching, NO persistent caching.

#### What is Shared

| Data | Scope | Mechanism |
|------|-------|-----------|
| **Position History** | Single request | Passed in `movesUci[]` array |
| **FEN Snapshot** | Single request | Computed from `movesUci` or provided by client |
| **ELO Band Config** | Server startup | Loaded from `elo-bands.ts` config file |
| **Engine Instance** | Engine pool | Reused across requests, but state cleared |
| **Move History Context** | Within request | Fed to engine via `position startpos moves ...` |

#### What is NOT Shared

| Data | Why Not Shared |
|------|----------------|
| **Engine Hash Tables** | Cleared via `ucinewgame` between Phase A and Phase C |
| **Transposition Tables** | Engine-specific, cleared between phases |
| **Analysis Results** | Not cached across requests (stateless server) |
| **User Suggestions** | Recomputed every request (ELO/personality may change) |

### Request-Scoped Caching Strategy

**Within a Single Request:**

```typescript
// Dual-phase execution shares engine instance but clears state
async function executeDualPhasePipeline(
  request: AnalyzeRequest,
  engine: ChessEngine
): Promise<AnalyzeResultResponse> {

  // ═════════════════════════════════════════════════════════════
  // PHASE A: Full-Strength Accuracy Review
  // ═════════════════════════════════════════════════════════════
  const startReview = Date.now()
  const accuracyPayload = await computeAccuracy(engine, request)
  const reviewMs = Date.now() - startReview

  // ═════════════════════════════════════════════════════════════
  // PHASE B: RESET ENGINE STATE (Anti-Contamination)
  // ═════════════════════════════════════════════════════════════
  // CRITICAL: Clear hash tables to prevent Phase A analysis from
  // influencing Phase C suggestions (user should not get "perfect"
  // suggestions based on full-strength hash entries)
  await engine.sendCommand('ucinewgame')
  await engine.sendCommand('isready')  // Wait for reset to complete

  // ═════════════════════════════════════════════════════════════
  // PHASE C: ELO-Tuned Suggestions
  // ═════════════════════════════════════════════════════════════
  const startSuggestions = Date.now()
  const suggestionsPayload = await generateSuggestions(engine, request)
  const suggestionMs = Date.now() - startSuggestions

  // ═════════════════════════════════════════════════════════════
  // BUILD RESPONSE
  // ═════════════════════════════════════════════════════════════
  return {
    type: 'analyze_result',
    version: '1.0',
    payload: {
      accuracy: accuracyPayload,
      suggestions: suggestionsPayload
    },
    meta: {
      engine: 'KomodoDragon',
      settingsUsed: {
        review: { /* Phase A config */ },
        suggestion: { /* Phase C config */ }
      },
      timings: {
        reviewMs,
        suggestionMs,
        totalMs: reviewMs + suggestionMs
      }
    }
  }
}
```

### Client-Side Caching (Extension)

**Purpose:** Display incremental stats updates without re-rendering entire UI.

**Mechanism:**

1. **FEN Hash Deduplication:**
   - Client computes hash of current FEN
   - If FEN unchanged since last request, skip sending request
   - Prevents duplicate requests for same position

2. **Accuracy Cache:**
   - Store last N plies of `AccuracyPly[]` in memory
   - On new analysis, merge old + new `perPly` arrays
   - Update rolling accuracy display (last 10 moves window)

3. **Suggestion Correlation:**
   - Track which suggestion was shown vs which move was played
   - Store `{ fenHash, shownSuggestions[], playedMove, matchIndex }`
   - Display feedback: "You played Best Move!" or "Played move: Inaccuracy (-12cp)"

**Implementation (Pseudo-Code):**

```typescript
// FILE: extension/src/domain/analysis/feedback-manager.ts

class FeedbackManager {
  private cache: Map<string, CachedAnalysis> = new Map()
  private currentSnapshot: FeedbackSnapshot | null = null

  async requestAnalysis(position: Position): Promise<void> {
    // Deduplication
    const fenHash = hashFen(position.fen)
    if (this.currentSnapshot?.fenHash === fenHash) {
      console.log('Skipping duplicate request for same position')
      return
    }

    // Send request
    this.currentSnapshot = {
      fenHash,
      fen: position.fen,
      movesUci: position.movesUci,
      state: 'REQUESTING',
      requestedAt: Date.now()
    }

    await websocketClient.send({
      type: 'analyze',
      requestId: generateRequestId(),
      payload: {
        movesUci: position.movesUci,
        fen: position.fen,
        review: { lastMoves: 10 },
        user: getUserSettings()
      }
    })
  }

  handleAnalysisResult(response: AnalyzeResultResponse): void {
    if (!this.currentSnapshot) return

    const { accuracy, suggestions } = response.payload

    // ─────────────────────────────────────────────────────────
    // MERGE ACCURACY DATA
    // ─────────────────────────────────────────────────────────
    const fenHash = this.currentSnapshot.fenHash
    const existingCache = this.cache.get(fenHash)

    let mergedPerPly: AccuracyPly[]
    if (existingCache) {
      // Merge old + new, keeping unique plies
      const existingPlyIndices = new Set(existingCache.perPly.map(p => p.plyIndex))
      const newPlies = accuracy.perPly.filter(p => !existingPlyIndices.has(p.plyIndex))
      mergedPerPly = [...existingCache.perPly, ...newPlies]
        .sort((a, b) => a.plyIndex - b.plyIndex)
    } else {
      mergedPerPly = accuracy.perPly
    }

    // Update cache
    this.cache.set(fenHash, {
      fenHash,
      perPly: mergedPerPly,
      overall: accuracy.overall,
      summary: accuracy.summary,
      lastUpdated: Date.now()
    })

    // ─────────────────────────────────────────────────────────
    // STORE SUGGESTIONS
    // ─────────────────────────────────────────────────────────
    this.currentSnapshot.state = 'SHOWING'
    this.currentSnapshot.suggestions = suggestions.suggestions
    this.currentSnapshot.chosenIndex = suggestions.chosenIndex

    // ─────────────────────────────────────────────────────────
    // DISPLAY UI
    // ─────────────────────────────────────────────────────────
    this.renderAccuracyDisplay(mergedPerPly, accuracy.overall)
    this.renderSuggestions(suggestions)
  }

  handleMovePlayed(playedMove: string): void {
    if (!this.currentSnapshot || this.currentSnapshot.state !== 'SHOWING') return

    // Correlate played move with shown suggestions
    const suggestions = this.currentSnapshot.suggestions || []
    const matchIndex = suggestions.findIndex(s => s.move === playedMove)

    const feedback: MoveFeedback = {
      playedMove,
      wasSuggested: matchIndex !== -1,
      matchIndex,
      label: matchIndex === 0 ? 'Best' :
             matchIndex > 0 ? suggestions[matchIndex].label :
             'Not Suggested'
    }

    // Display feedback toast
    this.showMoveFeedback(feedback)

    // Transition state
    this.currentSnapshot.state = 'MOVE_PLAYED'
    this.currentSnapshot.playedMove = playedMove
    this.currentSnapshot.feedback = feedback
  }
}
```

---

## Edge Cases & Handling

### 1. Bot Games (Chess.com Bots, Lichess Stockfish)

**Problem:** Bots play instantly, may not give user time to see suggestions.

**Detection:**
- Opponent username matches bot patterns: `@ComputerBot`, `Stockfish`, etc.
- Time between moves < 100ms consistently

**Handling:**
```typescript
if (gameMetadata.opponentIsBot) {
  // Disable auto-suggestions, only show on manual request
  feedbackManager.setMode('manual')
}
```

### 2. Correspondence Chess (Days/Move)

**Problem:** Game may span days, server has no persistent game state.

**Handling:**
- Client sends full `movesUci[]` history every request (stateless server)
- No special logic needed, works same as rapid/blitz

**Optimization:**
- Limit accuracy review to last 10 moves only (not entire game)
- Prevents 100+ move correspondence games from timing out

### 3. No-Timer Games (Unlimited Time)

**Problem:** Same as correspondence, long games.

**Handling:**
- Same as correspondence: analyze last N moves only
- Optional: Increase `lastMoves` config for casual games

### 4. Move Detection Issues

**Problem:** DOM observer misses move, or extracts wrong FEN.

**Symptoms:**
- Invalid UCI move in `movesUci[]` array
- FEN doesn't match move history

**Handling:**
```typescript
// Server-side validation
async function validateRequest(request: AnalyzeRequest): Promise<boolean> {
  const { movesUci, fen } = request.payload

  // Test 1: Replay moves with chess.js
  const chess = new Chess()
  try {
    for (const move of movesUci) {
      chess.move(move)
    }
  } catch (err) {
    logger.error('Invalid move history', { movesUci, error: err.message })
    return false  // Reject request
  }

  // Test 2: Compare computed FEN with provided FEN (if both exist)
  const computedFen = chess.fen()
  if (fen && computedFen !== fen) {
    logger.warn('FEN mismatch', { computed: computedFen, provided: fen })
    // Use computed FEN as source of truth
    request.payload.fen = computedFen
  }

  return true
}
```

**Client-side retry:**
```typescript
// If server rejects, re-extract position and retry once
if (response.type === 'error' && response.error.code === 'INVALID_POSITION') {
  const freshPosition = await domObserver.extractPosition()
  await feedbackManager.requestAnalysis(freshPosition)
}
```

### 5. Desync (Client Position ≠ Actual Position)

**Problem:** Extension thinks game is at move 20, but board shows move 21.

**Causes:**
- User navigated board backward/forward
- Takeback/undo happened
- Premove was executed

**Detection:**
```typescript
// Compare moveCount from DOM with cached moveCount
const domMoveCount = extractMoveCountFromDOM()
const cachedMoveCount = feedbackManager.getCurrentMoveCount()

if (domMoveCount !== cachedMoveCount) {
  logger.warn('Desync detected', { dom: domMoveCount, cached: cachedMoveCount })
  feedbackManager.reset()  // Clear cache
  await feedbackManager.requestAnalysis(freshPosition)
}
```

### 6. Premoves

**Problem:** User queues premove before opponent moves, suggestion shows for wrong position.

**Handling:**
- Detect premove via DOM mutation observer (queued move indicator)
- Delay suggestion request until premove executes
- After premove executes, request analysis for new position

```typescript
// Debounce position changes to wait for premove execution
const debouncedRequest = debounce(async (position: Position) => {
  await feedbackManager.requestAnalysis(position)
}, 300)  // Wait 300ms for position to stabilize
```

### 7. Takebacks

**Problem:** User requests takeback, move history reverts.

**Detection:**
- `movesUci.length` decreases vs previous request
- DOM shows "Takeback requested" or "Takeback accepted"

**Handling:**
```typescript
if (position.movesUci.length < cachedPosition.movesUci.length) {
  logger.info('Takeback detected')
  feedbackManager.reset()  // Clear suggestions and cache
  // Wait for game to stabilize before new request
  setTimeout(() => {
    feedbackManager.requestAnalysis(position)
  }, 1000)
}
```

### 8. Promotions

**Problem:** Pawn promotion UCI move needs promotion piece suffix.

**Correct Format:**
- `e7e8q` = promote to queen
- `e7e8r` = promote to rook
- `e7e8b` = promote to bishop
- `e7e8n` = promote to knight

**Validation:**
```typescript
// chess.js automatically handles promotion validation
const moveObj = chess.move(uciMove)
if (!moveObj) {
  throw new Error(`Invalid UCI move: ${uciMove}`)
}
if (moveObj.promotion) {
  // Verify UCI string has promotion suffix
  if (!uciMove.endsWith(moveObj.promotion)) {
    logger.warn('Missing promotion suffix', { uci: uciMove, promotion: moveObj.promotion })
  }
}
```

### 9. En Passant

**Problem:** En passant capture looks like empty square capture in FEN.

**Handling:**
- Chess.js correctly handles en passant via move history
- FEN includes en passant target square (e.g., `e3`)
- Engine receives full move history, so no issues

### 10. Threefold Repetition / 50-Move Rule

**Problem:** Game may end by draw claim mid-analysis.

**Handling:**
- Server continues analysis (draw claim is external)
- Client detects game end via DOM and stops requesting suggestions

```typescript
if (gameMetadata.gameOver) {
  feedbackManager.stopAutoSuggestions()
  logger.info('Game ended', { result: gameMetadata.result })
}
```

### 11. Time Pressure (< 10s on clock)

**Problem:** Suggestions may arrive too late to be useful.

**Handling:**
```typescript
// Reduce suggestion quality to prioritize speed
if (playerClock < 10) {
  request.user.targetElo = Math.max(1000, request.user.targetElo - 500)  // Faster, lower quality
  request.user.multiPV = 1  // Only show best move
}
```

### 12. Puzzle Rush / Timed Challenges

**Problem:** No game ID, rapid position changes.

**Handling:**
- Disable auto-suggestions (too fast)
- Allow manual trigger only
- Use faster engine config (movetimeMs=200)

---

## Performance Constraints

### Latency Targets

| Phase | Target | Acceptable | Max |
|-------|--------|------------|-----|
| **Phase A (Accuracy)** | 1.5s | 3s | 5s |
| **Phase C (Suggestions)** | 1s | 2s | 4s |
| **End-to-End** | 2.5s | 5s | 9s |
| **WebSocket RTT** | 50ms | 200ms | 500ms |

### Timeout Configuration

```typescript
// FILE: server/src/analyze-pipeline.ts

const TIMEOUTS = {
  // Engine acquisition from pool
  ENGINE_ACQUIRE_MS: 30000,  // 30s (includes scale-up time)

  // Phase A: Per-ply analysis
  REVIEW_PLY_MS: 80,          // 80ms search time
  REVIEW_PLY_TIMEOUT_MS: 300, // 300ms total timeout (includes parsing)

  // Phase C: Suggestion generation
  SUGGESTION_BASE_MS: 100,     // Min time (ELO 500)
  SUGGESTION_MAX_MS: 3000,     // Max time (ELO 2500+)
  SUGGESTION_TIMEOUT_MS: 5000, // Grace period

  // Engine command execution
  UCI_COMMAND_TIMEOUT_MS: 1000,  // Generic UCI command

  // Engine reset
  RESET_TIMEOUT_MS: 2000,  // ucinewgame + isready

  // Overall request timeout (end-to-end)
  REQUEST_TIMEOUT_MS: 60000,  // 60s (reject if not complete)
}
```

### Concurrency Limits

**Engine Pool:**

```typescript
// FILE: server/src/engine-pool.ts

const POOL_CONFIG = {
  MIN_ENGINES: 1,      // Always keep 1 warm
  MAX_ENGINES: 4,      // Cap at 4 (memory constraint)
  SCALE_UP_THRESHOLD: 2,  // Scale up if queue ≥ 2 requests
  SCALE_DOWN_IDLE_MS: 60000,  // Terminate idle engine after 60s
  RESTART_COOLDOWN_MS: 5000,  // Wait 5s before restarting dead engine
}
```

**Request Queue:**

```typescript
// FIFO queue, no priority
class RequestQueue {
  private queue: PendingRequest[] = []

  enqueue(request: PendingRequest): void {
    this.queue.push(request)

    // Reject if queue too long (backpressure)
    if (this.queue.length > 20) {
      const oldest = this.queue.shift()!
      oldest.reject(new Error('Server overloaded, request dropped'))
    }
  }

  dequeue(): PendingRequest | undefined {
    return this.queue.shift()  // FIFO
  }
}
```

### Resource Limits

**Per-Engine Memory:**

```typescript
// Hash table size (RAM)
const hashMB = getEloBandSettings(targetElo).hashMB
// Range: 32MB (ELO 500) to 256MB (ELO 2500)
// Max total RAM with 4 engines: 4 * 256MB = 1GB
```

**CPU:**

```typescript
// Threads per engine
const THREADS_PER_ENGINE = 2  // Balance between speed and CPU contention
// Max total threads: 4 engines * 2 threads = 8 cores
```

**Disk I/O:**

```typescript
// Komodo Dragon loads personality files on startup
// No disk I/O during analysis (all in-memory)
```

### Bottleneck Analysis

| Bottleneck | Symptom | Mitigation |
|------------|---------|------------|
| **Engine Pool Exhaustion** | Requests queue up, latency spikes | Scale up to MAX_ENGINES=4 |
| **CPU Saturation** | Analysis takes longer than movetime | Reduce THREADS_PER_ENGINE or MAX_ENGINES |
| **Memory Pressure** | OOM kills, engine crashes | Reduce hashMB or MAX_ENGINES |
| **WebSocket Bandwidth** | Response delays | Enable compression (ws `permessage-deflate`) |
| **Chess.js Overhead** | Move validation slow for 100+ move games | Cache chess.js instance per request |

---

## Telemetry & Observability

### Metrics (Prometheus Format)

**Suggested Metrics to Instrument:**

```typescript
// FILE: server/src/metrics.ts

import { Counter, Histogram, Gauge } from 'prom-client'

// ═════════════════════════════════════════════════════════════
// REQUEST METRICS
// ═════════════════════════════════════════════════════════════

export const requestsTotal = new Counter({
  name: 'chessr_requests_total',
  help: 'Total analyze requests received',
  labelNames: ['result']  // 'success' | 'error' | 'timeout' | 'invalid'
})

export const requestDuration = new Histogram({
  name: 'chessr_request_duration_seconds',
  help: 'End-to-end request duration',
  labelNames: ['phase'],  // 'review' | 'suggestion' | 'total'
  buckets: [0.5, 1, 2, 3, 5, 10, 30]
})

// ═════════════════════════════════════════════════════════════
// ENGINE POOL METRICS
// ═════════════════════════════════════════════════════════════

export const enginePoolSize = new Gauge({
  name: 'chessr_engine_pool_size',
  help: 'Current number of engines in pool',
  labelNames: ['status']  // 'available' | 'busy'
})

export const enginePoolQueue = new Gauge({
  name: 'chessr_engine_pool_queue_length',
  help: 'Number of requests waiting for engine'
})

export const engineRestarts = new Counter({
  name: 'chessr_engine_restarts_total',
  help: 'Total engine restarts due to crashes',
  labelNames: ['reason']  // 'dead' | 'timeout' | 'error'
})

// ═════════════════════════════════════════════════════════════
// ANALYSIS METRICS
// ═════════════════════════════════════════════════════════════

export const pliesAnalyzed = new Counter({
  name: 'chessr_plies_analyzed_total',
  help: 'Total plies analyzed in Phase A'
})

export const suggestionsGenerated = new Counter({
  name: 'chessr_suggestions_generated_total',
  help: 'Total suggestions generated',
  labelNames: ['multiPV']  // '1' | '2' | '3' | ...
})

export const accuracyDistribution = new Histogram({
  name: 'chessr_accuracy_overall',
  help: 'Distribution of overall accuracy scores',
  buckets: [0, 20, 40, 60, 80, 90, 95, 100]
})

// ═════════════════════════════════════════════════════════════
// ELO METRICS
// ═════════════════════════════════════════════════════════════

export const requestsByElo = new Counter({
  name: 'chessr_requests_by_elo_total',
  help: 'Requests grouped by ELO band',
  labelNames: ['eloBand']  // '<800' | '800-1100' | '1100-1400' | ...
})

// ═════════════════════════════════════════════════════════════
// ERROR METRICS
// ═════════════════════════════════════════════════════════════

export const errorsTotal = new Counter({
  name: 'chessr_errors_total',
  help: 'Total errors by type',
  labelNames: ['errorType']  // 'invalid_position' | 'engine_timeout' | 'parse_error' | ...
})
```

**Instrumentation Example:**

```typescript
// FILE: server/src/analyze-pipeline.ts

export async function executeAnalyzePipeline(
  request: AnalyzeRequest
): Promise<AnalyzeResultResponse> {

  const startTime = Date.now()

  try {
    // ─────────────────────────────────────────────────────────
    // Acquire Engine
    // ─────────────────────────────────────────────────────────
    enginePoolQueue.set(enginePool.getQueueLength())

    const engine = await enginePool.getEngineForDirectUse()

    enginePoolSize.set({ status: 'busy' }, enginePool.getBusyCount())
    enginePoolSize.set({ status: 'available' }, enginePool.getAvailableCount())

    // ─────────────────────────────────────────────────────────
    // Phase A: Accuracy
    // ─────────────────────────────────────────────────────────
    const reviewStart = Date.now()
    const accuracy = await computeAccuracy(engine, request)
    const reviewMs = Date.now() - reviewStart

    requestDuration.observe({ phase: 'review' }, reviewMs / 1000)
    pliesAnalyzed.inc(accuracy.perPly.length)
    accuracyDistribution.observe(accuracy.overall)

    // ─────────────────────────────────────────────────────────
    // Phase B: Reset
    // ─────────────────────────────────────────────────────────
    await engine.sendCommand('ucinewgame')
    await engine.sendCommand('isready')

    // ─────────────────────────────────────────────────────────
    // Phase C: Suggestions
    // ─────────────────────────────────────────────────────────
    const suggestionStart = Date.now()
    const suggestions = await generateSuggestions(engine, request)
    const suggestionMs = Date.now() - suggestionStart

    requestDuration.observe({ phase: 'suggestion' }, suggestionMs / 1000)
    suggestionsGenerated.inc({ multiPV: request.payload.user.multiPV }, suggestions.suggestions.length)

    // ─────────────────────────────────────────────────────────
    // Release Engine
    // ─────────────────────────────────────────────────────────
    enginePool.releaseEngine(engine)

    enginePoolSize.set({ status: 'busy' }, enginePool.getBusyCount())
    enginePoolSize.set({ status: 'available' }, enginePool.getAvailableCount())

    // ─────────────────────────────────────────────────────────
    // Record Success
    // ─────────────────────────────────────────────────────────
    const totalMs = Date.now() - startTime
    requestDuration.observe({ phase: 'total' }, totalMs / 1000)
    requestsTotal.inc({ result: 'success' })
    requestsByElo.inc({ eloBand: getEloBand(request.payload.user.targetElo) })

    return {
      type: 'analyze_result',
      version: '1.0',
      payload: { accuracy, suggestions },
      meta: {
        engine: 'KomodoDragon',
        settingsUsed: { /* ... */ },
        timings: { reviewMs, suggestionMs, totalMs }
      }
    }

  } catch (err) {
    // ─────────────────────────────────────────────────────────
    // Record Error
    // ─────────────────────────────────────────────────────────
    const errorType = err.code || 'unknown'
    errorsTotal.inc({ errorType })
    requestsTotal.inc({ result: 'error' })

    throw err
  }
}
```

### Structured Logging

**Log Levels:**

```typescript
enum LogLevel {
  DEBUG = 'debug',    // Verbose, engine I/O
  INFO = 'info',      // Request lifecycle
  WARN = 'warn',      // Recoverable errors
  ERROR = 'error',    // Unrecoverable errors
  FATAL = 'fatal'     // Server crash
}
```

**Recommended Log Events:**

```typescript
// FILE: server/src/logger.ts

import winston from 'winston'

export const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/chessr.log' })
  ]
})

// ═════════════════════════════════════════════════════════════
// LOG EVENT EXAMPLES
// ═════════════════════════════════════════════════════════════

// Request received
logger.info('Request received', {
  requestId: 'req_123',
  movesCount: 24,
  targetElo: 1500,
  personality: 'Default',
  multiPV: 3
})

// Engine acquired
logger.debug('Engine acquired', {
  requestId: 'req_123',
  engineId: 'engine_2',
  queueTimeMs: 50
})

// Phase started
logger.info('Phase started', {
  requestId: 'req_123',
  phase: 'accuracy',
  config: { hashMB: 256, movetimeMs: 80, multiPV: 2 }
})

// Ply analyzed
logger.debug('Ply analyzed', {
  requestId: 'req_123',
  plyIndex: 18,
  playedMove: 'e4e5',
  bestMove: 'e4e5',
  lossWinPercent: 0.1,
  classification: 'Best'
})

// Phase completed
logger.info('Phase completed', {
  requestId: 'req_123',
  phase: 'accuracy',
  durationMs: 1450,
  pliesAnalyzed: 18,
  overallAccuracy: 87.3
})

// Engine released
logger.debug('Engine released', {
  requestId: 'req_123',
  engineId: 'engine_2',
  availableEngines: 2
})

// Request completed
logger.info('Request completed', {
  requestId: 'req_123',
  totalMs: 2650,
  reviewMs: 1450,
  suggestionMs: 1100
})

// Error occurred
logger.error('Engine timeout', {
  requestId: 'req_123',
  engineId: 'engine_3',
  phase: 'suggestion',
  timeoutMs: 5000,
  error: err.message,
  stack: err.stack
})

// Engine restart
logger.warn('Engine restarted', {
  engineId: 'engine_1',
  reason: 'dead',
  restartCount: 2,
  cooldownMs: 5000
})
```

### Grafana Dashboard

**Recommended Panels:**

1. **Request Rate**
   - Metric: `rate(chessr_requests_total[5m])`
   - Visualization: Time series graph
   - Group by: `result` label

2. **Request Latency (P50, P95, P99)**
   - Metric: `histogram_quantile(0.95, chessr_request_duration_seconds)`
   - Visualization: Time series graph
   - Group by: `phase` label

3. **Engine Pool Utilization**
   - Metrics:
     - `chessr_engine_pool_size{status="busy"}`
     - `chessr_engine_pool_size{status="available"}`
   - Visualization: Stacked area chart

4. **Queue Length**
   - Metric: `chessr_engine_pool_queue_length`
   - Visualization: Time series graph
   - Alert: Queue length > 5 for 1 minute

5. **Engine Restart Rate**
   - Metric: `rate(chessr_engine_restarts_total[5m])`
   - Visualization: Time series graph
   - Alert: Restart rate > 0.1/min

6. **Accuracy Distribution**
   - Metric: `chessr_accuracy_overall`
   - Visualization: Heatmap or histogram

7. **Error Rate by Type**
   - Metric: `rate(chessr_errors_total[5m])`
   - Visualization: Stacked bar chart
   - Group by: `errorType` label

8. **Requests by ELO Band**
   - Metric: `chessr_requests_by_elo_total`
   - Visualization: Pie chart or bar chart
   - Group by: `eloBand` label

---

## MCTS vs Classic Search Decision

### Background

Komodo Dragon 3.3 is a **hybrid engine** that combines:
- **Alpha-Beta Search** (classic minimax with pruning)
- **MCTS** (Monte Carlo Tree Search, similar to AlphaZero)

The engine automatically blends these methods based on position type and configuration.

### Decision Matrix

| Factor | MCTS | Classic Alpha-Beta | **Recommendation** |
|--------|------|-------------------|-------------------|
| **Human-like moves** | ✅ Better (probabilistic) | ❌ Deterministic | MCTS |
| **Multi-PV support** | ⚠️ "Free" (visit counts) | ✅ Native MultiPV | Both OK |
| **Latency** | ⚠️ Needs more time | ✅ Faster for same depth | Classic |
| **Tactical positions** | ❌ Weaker | ✅ Stronger | Classic |
| **Strategic positions** | ✅ Stronger | ⚠️ Horizon effects | MCTS |
| **Consistency** | ❌ Varies with seed | ✅ Deterministic | Classic |
| **Komodo Dragon support** | ✅ Built-in hybrid | ✅ Built-in | **Hybrid (default)** |

### Recommendation: Use Hybrid Mode (Default)

**Rationale:**

1. **Komodo Dragon automatically optimizes:** The engine internally decides when to use MCTS vs alpha-beta based on position characteristics. You don't need to choose.

2. **Personality system leverages both:** The `Human` personality uses more MCTS-style evaluation, while `Default` uses more alpha-beta. This is handled internally.

3. **MultiPV works in both modes:** Komodo Dragon's MultiPV returns top N candidates regardless of internal search method.

4. **Consistency via ELO Limit Strength:** Instead of relying on MCTS randomness for "humanization," use the **UCI_LimitStrength + UCI_Elo** options to introduce natural inaccuracies.

**Configuration:**

```typescript
// Don't set any MCTS-specific options, let engine decide
await engine.setOption('UCI_LimitStrength', true)
await engine.setOption('UCI_Elo', targetElo)  // 500-2500
await engine.setPersonality(personality)  // 'Human' uses more MCTS internally
await engine.setOption('MultiPV', multiPV)  // Works with hybrid mode
```

**When to Override (Advanced):**

If you want to force pure MCTS mode (NOT recommended):
```typescript
// Force MCTS (not recommended, loses tactical strength)
await engine.setOption('MCTS', true)  // Komodo Dragon specific
await engine.setOption('MCTSThreads', 2)
```

---

## MultiPV Implementation Strategy

### Current Implementation

**Phase A (Accuracy Review):**
- MultiPV = 2 (get best + 2nd-best for gap calculation)
- Used to compute `gapWin`, `gapCp` for "Great" move detection

**Phase C (User Suggestions):**
- MultiPV = user.multiPV (1-8, configurable)
- Returns top N candidates with scores, PVs, labels

### How MultiPV Works Internally

**Alpha-Beta Mode:**
- Engine runs full search N times, each time excluding previous best moves
- Overhead: ~N × single-PV time (but with shared hash table benefits)

**MCTS Mode:**
- Engine explores tree naturally, visit counts give top N candidates "for free"
- Overhead: Minimal (same tree, just report top N by visits)

### Optimization: Dynamic MultiPV

**Problem:** User requests MultiPV=3, but position may only have 1-2 good moves.

**Solution:** Filter out bad suggestions, only return quality candidates.

```typescript
// FILE: server/src/analyze-pipeline.ts

async function generateSuggestions(
  engine: ChessEngine,
  request: AnalyzeRequest
): Promise<SuggestionsPayload> {

  const { multiPV } = request.payload.user

  // Request MultiPV from engine
  await engine.setOption('MultiPV', multiPV)
  const result = await engine.analyze({ command: `go movetime ${movetimeMs}` })

  const bestScore = result.multiPvLines.get(1)!.score
  const filtered: SuggestionMove[] = []

  for (const [index, line] of result.multiPvLines.entries()) {
    const scoreDelta = Math.abs(getScoreValue(line.score) - getScoreValue(bestScore))

    // Filter out candidates that are too weak
    if (scoreDelta > 200) {  // > 2 pawns worse
      logger.debug('Filtered weak suggestion', {
        move: line.move,
        scoreDelta,
        index
      })
      continue  // Skip this candidate
    }

    // Filter out moves allowing immediate mate
    if (checkMateThreat(chess, line.move)) {
      logger.debug('Filtered mate-threat suggestion', {
        move: line.move,
        index
      })
      continue
    }

    filtered.push(enrichSuggestion(line, index, bestScore))
  }

  // Always return at least 1 suggestion (the best move)
  if (filtered.length === 0) {
    filtered.push(enrichSuggestion(result.multiPvLines.get(1)!, 1, bestScore))
  }

  return {
    context: { /* ... */ },
    userSettings: { /* ... */ },
    computeSettings: { /* ... */ },
    suggestions: filtered,
    chosenIndex: 0
  }
}
```

### Recommendation: Adaptive MultiPV by ELO

**Insight:** Lower-rated players benefit more from seeing alternatives, higher-rated players prefer fewer distractions.

```typescript
// FILE: server/src/elo-bands.ts

export function getDefaultMultiPV(targetElo: number): number {
  if (targetElo < 1000) return 1   // Beginners: show only best
  if (targetElo < 1400) return 2   // Intermediate: show best + 1 alt
  if (targetElo < 1800) return 3   // Advanced: show 3 options
  return 3  // Expert: show 3 options (but they can override)
}
```

---

## Consistency & Caching Strategy

### Problem: Suggestion Flicker

**Scenario:**
1. User requests suggestions at move 15 → Engine returns `Nf3` as best
2. User thinks for 5 seconds
3. User requests suggestions again (same position) → Engine returns `Nc3` as best

**Causes:**
- Engine search is **non-deterministic** (MCTS randomness, timing variations)
- Hash table state differs between requests (even for same position)

### Solution 1: Request-Level Deduplication (Client-Side)

**Implementation:**

```typescript
// FILE: extension/src/domain/analysis/feedback-manager.ts

class FeedbackManager {
  private currentSnapshot: FeedbackSnapshot | null = null

  async requestAnalysis(position: Position): Promise<void> {
    const fenHash = hashFen(position.fen)

    // Deduplication: Skip if same position
    if (this.currentSnapshot?.fenHash === fenHash &&
        this.currentSnapshot.state === 'SHOWING') {
      console.log('Skipping duplicate request for same position')
      return  // Don't send request, use cached suggestions
    }

    // Send new request
    this.currentSnapshot = {
      fenHash,
      fen: position.fen,
      state: 'REQUESTING',
      requestedAt: Date.now()
    }

    await websocketClient.send({ /* ... */ })
  }
}
```

**Result:** Same position won't flicker unless user explicitly re-requests.

### Solution 2: Server-Side Short-TTL Cache (Optional)

**Implementation:**

```typescript
// FILE: server/src/suggestion-cache.ts

import LRU from 'lru-cache'

interface CacheKey {
  fen: string
  targetElo: number
  personality: string
  multiPV: number
}

interface CacheValue {
  suggestions: SuggestionsPayload
  cachedAt: number
}

const suggestionCache = new LRU<string, CacheValue>({
  max: 1000,  // Cache up to 1000 positions
  ttl: 30000  // 30s TTL (short-lived)
})

function getCacheKey(key: CacheKey): string {
  return `${key.fen}:${key.targetElo}:${key.personality}:${key.multiPV}`
}

export async function generateSuggestionsWithCache(
  engine: ChessEngine,
  request: AnalyzeRequest
): Promise<SuggestionsPayload> {

  const cacheKey = getCacheKey({
    fen: request.payload.fen || computeFenFromMoves(request.payload.movesUci),
    targetElo: request.payload.user.targetElo,
    personality: request.payload.user.personality,
    multiPV: request.payload.user.multiPV
  })

  // Check cache
  const cached = suggestionCache.get(cacheKey)
  if (cached) {
    logger.debug('Cache hit', { cacheKey, ageMs: Date.now() - cached.cachedAt })
    return cached.suggestions
  }

  // Cache miss: compute suggestions
  const suggestions = await generateSuggestions(engine, request)

  // Store in cache
  suggestionCache.set(cacheKey, {
    suggestions,
    cachedAt: Date.now()
  })

  return suggestions
}
```

**Trade-offs:**

| Approach | Pros | Cons |
|----------|------|------|
| **Client-Side Dedup** | Simple, no server state | User can't force refresh |
| **Server-Side Cache** | Consistent across clients | Adds memory overhead, stale data |
| **No Caching** | Always fresh | Suggestion flicker |

**Recommendation:** Use **client-side deduplication only**. Keep server stateless.

### Solution 3: Deterministic Engine Config (Partial)

**Goal:** Reduce non-determinism by fixing random seeds.

**Implementation:**

```typescript
// Set fixed seed for MCTS (Komodo Dragon specific)
await engine.setOption('MCTSSeed', 42)  // Fixed seed

// Use fixed time (not nodes, which varies by CPU load)
await engine.sendCommand(`go movetime ${movetimeMs}`)
```

**Limitations:**
- Doesn't fully eliminate non-determinism (timing still varies)
- Not recommended (loses diversity benefits of MCTS)

**Recommendation:** Don't use fixed seeds. Rely on client-side deduplication instead.

---

## Recommended Architecture

### Folder Structure

```
chessr/
├── server/
│   ├── src/
│   │   ├── index.ts                 # WebSocket server entry point
│   │   ├── analyze-pipeline.ts      # Dual-phase orchestration
│   │   ├── engine.ts                # ChessEngine UCI wrapper
│   │   ├── engine-pool.ts           # EnginePool resource manager
│   │   ├── elo-bands.ts             # ELO band configurations
│   │   ├── stats-calculator.ts      # Accuracy, ACPL, classification
│   │   ├── uci-helpers-classify.ts  # Chess.com-style move classification
│   │   ├── suggestion-generator.ts  # Phase C: suggestion logic (NEW)
│   │   ├── accuracy-reviewer.ts     # Phase A: accuracy logic (NEW)
│   │   ├── metrics.ts               # Prometheus metrics
│   │   ├── logger.ts                # Winston structured logging
│   │   ├── types.ts                 # Shared types
│   │   └── validation.ts            # Request validation (NEW)
│   ├── tests/
│   │   ├── analyze-pipeline.test.ts
│   │   ├── engine-pool.test.ts
│   │   └── stats-calculator.test.ts
│   └── package.json
├── extension/
│   ├── src/
│   │   ├── content/
│   │   │   ├── dom-observer.ts      # Position extraction
│   │   │   ├── websocket-client.ts  # WS connection
│   │   │   └── move-detector.ts     # Move played detection
│   │   ├── domain/
│   │   │   └── analysis/
│   │   │       ├── feedback-types.ts    # State machine, types
│   │   │       ├── feedback-manager.ts  # Request orchestration (NEW)
│   │   │       └── accuracy-cache.ts    # Client-side cache (NEW)
│   │   ├── presentation/
│   │   │   └── components/
│   │   │       ├── SuggestionPanel.tsx  # Display suggestions
│   │   │       └── AccuracyPanel.tsx    # Display accuracy
│   │   └── shared/
│   │       ├── types.ts
│   │       └── defaults.ts
│   └── package.json
├── docs/
│   ├── SUGGESTION_AND_STATS_SPEC.md  # This document
│   ├── API.md                         # Request/response examples
│   └── DEPLOYMENT.md                  # Server deployment guide
└── README.md
```

### New Files to Create

**1. `server/src/suggestion-generator.ts`**

Extract Phase C logic from `analyze-pipeline.ts` into dedicated module.

```typescript
export async function generateSuggestions(
  engine: ChessEngine,
  request: AnalyzeRequest
): Promise<SuggestionsPayload> {
  // Implementation from "Suggestion Pipeline" section
}
```

**2. `server/src/accuracy-reviewer.ts`**

Extract Phase A logic from `analyze-pipeline.ts` into dedicated module.

```typescript
export async function computeAccuracy(
  engine: ChessEngine,
  request: AnalyzeRequest
): Promise<AccuracyPayload> {
  // Implementation from "Stats Pipeline" section
}
```

**3. `server/src/validation.ts`**

Request validation and sanitization.

```typescript
export async function validateAnalyzeRequest(
  request: AnalyzeRequest
): Promise<{ valid: boolean; error?: string }> {
  // Validate movesUci, FEN, ELO range, etc.
}
```

**4. `extension/src/domain/analysis/feedback-manager.ts`**

Centralized client-side request management.

```typescript
export class FeedbackManager {
  async requestAnalysis(position: Position): Promise<void>
  handleAnalysisResult(response: AnalyzeResultResponse): void
  handleMovePlayed(playedMove: string): void
}
```

**5. `extension/src/domain/analysis/accuracy-cache.ts`**

Client-side accuracy caching for incremental updates.

```typescript
export class AccuracyCache {
  merge(oldData: AccuracyPly[], newData: AccuracyPly[]): AccuracyPly[]
  getOverallAccuracy(lastN: number): number
}
```

---

## Appendices

### A. ELO Band Configuration Table

| ELO Range | Hash (MB) | Movetime (ms) | Nodes Main | Nodes Cand | Window (cp) | Temp (cp) |
|-----------|-----------|---------------|------------|------------|-------------|-----------|
| < 800     | 32        | 100           | 30,000     | 3,000      | 120         | 60        |
| 800-1100  | 64        | 300           | 100,000    | 10,000     | 90          | 45        |
| 1100-1400 | 96        | 600           | 300,000    | 20,000     | 60          | 30        |
| 1400-1700 | 128       | 1000          | 600,000    | 30,000     | 40          | 20        |
| 1700-2000 | 192       | 2000          | 1,500,000  | 40,000     | 25          | 15        |
| 2000+     | 256       | 3000          | 2,500,000  | 50,000     | 20          | 15        |

### B. Move Classification Thresholds

| Classification | Win% Loss | Special Conditions |
|----------------|-----------|-------------------|
| **Brilliant**  | 0-0.2%    | Material sacrifice (≥3 pawns) + Winning position (eval > +1) |
| **Great**      | 0-1%      | Gap to 2nd-best > 3% OR Material sacrifice + Advantage |
| **Best**       | 0-0.2%    | Normal best move |
| **Excellent**  | 0.2-1%    | Slight inaccuracy |
| **Good**       | 1-3%      | Minor inaccuracy |
| **Inaccuracy** | 3-8%      | Noticeable mistake |
| **Mistake**    | 8-20%     | Significant error |
| **Blunder**    | > 20%     | Losing move OR allows mate-in-1 |

### C. UCI Command Reference

```bash
# Initialize engine
uci
setoption name Hash value 256
setoption name Threads value 2
setoption name UCI_LimitStrength value true
setoption name UCI_Elo value 1500
setoption name Personality value Default
setoption name MultiPV value 3
isready

# Set position
position startpos moves e2e4 e7e5 g1f3
# OR
position fen rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1

# Run search
go movetime 1000
# OR
go nodes 1000000
# OR
go depth 20

# Clear hash (between phases)
ucinewgame
isready

# Quit
quit
```

### D. Personality Traits (Komodo Dragon)

| Personality | Characteristics | Use Case |
|-------------|----------------|----------|
| **Default** | Balanced, universal | General use |
| **Aggressive** | Tactical, sacrificial, attacking | Players who like sharp positions |
| **Defensive** | Solid, prophylactic, risk-averse | Players who prefer safe play |
| **Active** | Dynamic piece activity, initiative | Players who value piece coordination |
| **Positional** | Strategic, structural, pawn play | Players who think long-term |
| **Endgame** | Technical precision, simplification | Endgame specialists |
| **Beginner** | Simple, clear, instructive | Learning players |
| **Human** | Human-like eval, probabilistic | Most human-like suggestions |

---

## Conclusion

This specification provides a complete blueprint for implementing and understanding Chessr's suggestion and stats computation system. Key takeaways:

1. **Dual-Phase Pipeline**: Separate accuracy review (full-strength) from user suggestions (ELO-tuned) with anti-contamination reset.

2. **White POV Normalization**: All evaluations stored in White's perspective to eliminate side-to-move confusion.

3. **Win% Loss Primary Metric**: More human-aligned than centipawn loss, used for both classification and accuracy.

4. **Hybrid Search Mode**: Let Komodo Dragon automatically blend MCTS + Alpha-Beta based on position.

5. **Client-Side Deduplication**: Prevent suggestion flicker without server-side caching.

6. **Dynamic Engine Pool**: Auto-scale based on demand, with health checks and restart logic.

7. **Comprehensive Telemetry**: Prometheus metrics + structured logs for observability.

**Next Steps:**

1. Review this spec with team for technical accuracy
2. Implement new modular files (`suggestion-generator.ts`, `accuracy-reviewer.ts`, etc.)
3. Add Prometheus metrics instrumentation
4. Set up Grafana dashboards
5. Write integration tests for dual-phase pipeline
6. Document edge case handling in code comments
7. Load test with concurrent requests to validate engine pool scaling

**Feedback Welcome:**

This is a living document. Please submit issues or PRs with:
- Implementation questions
- Edge cases not covered
- Performance optimization ideas
- Alternative approaches to consider

---

**Document Version:** 1.0
**Last Updated:** 2026-01-30
**Maintained By:** Chessr Engineering Team
