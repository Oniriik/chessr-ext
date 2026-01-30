# Settings Processing & Request Handling

This document explains how the server processes analysis requests with different settings configurations, particularly focusing on the `disableLimitStrength` parameter.

## Request Structure

```typescript
interface AnalyzeRequest {
  type: 'analyze';
  requestId: string;
  payload: {
    movesUci: string[];  // Full game history in UCI format
    review: {
      lastMoves: number;  // Number of moves to review for accuracy (default: 10)
    };
    user: {
      targetElo: number;           // Target ELO (300-3000)
      personality: Personality;     // Komodo personality
      multiPV: number;              // Number of suggestion lines (1-8)
      disableLimitStrength?: boolean;  // Disable UCI_LimitStrength (only effective at 2000+ ELO)
    };
  };
}
```

## Analysis Pipeline Phases

### Phase A: Accuracy Review (Always Full Strength)
- **Purpose**: Calculate player accuracy by comparing moves to engine's best lines
- **Configuration**:
  - `UCI_LimitStrength`: **ALWAYS false** (full strength)
  - `Hash`: 256 MB
  - `MultiPV`: 1 (only best move)
  - `Movetime`: 80ms per position
- **Output**: Accuracy percentage, centipawn loss, move classifications

### Phase B: Reset (Anti-Contamination)
- **Purpose**: Clear engine state between phases
- **Actions**: Send `ucinewgame` command

### Phase C: User-Mode Suggestions (Respects Settings)
- **Purpose**: Generate move suggestions at user's target strength
- **Configuration**: Based on user settings
- **Output**: Multiple suggestion lines with evaluations

---

## Example Scenarios

### Example 1: Beginner Player (ELO 800)
**Request:**
```json
{
  "type": "analyze",
  "requestId": "abc123",
  "payload": {
    "movesUci": ["e2e4", "e7e5", "g1f3"],
    "review": {
      "lastMoves": 10
    },
    "user": {
      "targetElo": 800,
      "personality": "Beginner",
      "multiPV": 3,
      "disableLimitStrength": false
    }
  }
}
```

**Server Processing:**

```
Phase A: Accuracy Review
├─ UCI_LimitStrength: false  ✓ (Full strength ~3200 ELO)
├─ Hash: 256 MB
└─ Result: Player accuracy = 92.5%

Phase B: Reset
└─ ucinewame

Phase C: Suggestions at ELO 800
├─ targetElo: 800
├─ disableLimitStrength: false
├─ Computed: shouldLimitStrength = true  ✓
├─ UCI_LimitStrength: true  ✓
├─ UCI_Elo: 800  ✓
├─ Personality: Beginner
├─ Hash: 64 MB (computed for ELO 800)
├─ Movetime: 200ms (computed for ELO 800)
└─ Result: 3 suggestions at ~800 strength
    #1: Nc3 (+0.2)  [Best]
    #2: Bc4 (+0.1)  [Safe]
    #3: d3  (0.0)   [Alt]
```

**Response settingsUsed:**
```json
{
  "review": {
    "hashMB": 256,
    "limitStrength": false,
    "multiPV": 1
  },
  "suggestion": {
    "hashMB": 64,
    "limitStrength": true,      // ← Limited to 800 ELO
    "targetElo": 800,
    "personality": "Beginner",
    "multiPV": 3
  }
}
```

---

### Example 2: Advanced Player (ELO 2200, Limit Disabled)
**Request:**
```json
{
  "type": "analyze",
  "payload": {
    "user": {
      "targetElo": 2200,
      "personality": "Default",
      "multiPV": 3,
      "disableLimitStrength": true  // ← User wants full strength
    }
  }
}
```

**Server Processing:**

```
Phase C: Suggestions at FULL STRENGTH
├─ targetElo: 2200
├─ disableLimitStrength: true  ✓
├─ Computed: shouldLimitStrength = false  ✓ (2200 >= 2000 && disabled)
├─ UCI_LimitStrength: false  ✓✓  FULL STRENGTH
├─ UCI_Elo: NOT SET  ✓✓  (only set when limiting)
├─ Personality: Default
├─ Hash: 256 MB (computed for high ELO)
├─ Movetime: 1200ms
└─ Result: 3 suggestions at ~3200 strength (Komodo full power)
    #1: Nf6 (+0.45)  [Best]
    #2: d5  (+0.42)  [Safe]
    #3: c5  (+0.38)  [Alt]
```

**Response settingsUsed:**
```json
{
  "suggestion": {
    "hashMB": 256,
    "limitStrength": false,     // ← FULL STRENGTH
    "targetElo": 2200,          // ← Still tracked for display
    "personality": "Default",
    "multiPV": 3
  }
}
```

---

### Example 3: Advanced Player (ELO 2200, Limit Enabled - Default)
**Request:**
```json
{
  "type": "analyze",
  "payload": {
    "user": {
      "targetElo": 2200,
      "personality": "Aggressive",
      "multiPV": 2,
      "disableLimitStrength": false  // ← Default: keep limit
    }
  }
}
```

**Server Processing:**

```
Phase C: Suggestions at ELO 2200
├─ targetElo: 2200
├─ disableLimitStrength: false
├─ Computed: shouldLimitStrength = true  ✓ (disabled=false)
├─ UCI_LimitStrength: true  ✓
├─ UCI_Elo: 2200  ✓
├─ Personality: Aggressive
├─ Hash: 256 MB
├─ Movetime: 1200ms
└─ Result: 2 suggestions at ~2200 strength
    #1: e4 (+0.35)  [Best]
    #2: d4 (+0.28)  [Safe]
```

**Response settingsUsed:**
```json
{
  "suggestion": {
    "hashMB": 256,
    "limitStrength": true,      // ← Limited to 2200 ELO
    "targetElo": 2200,
    "personality": "Aggressive",
    "multiPV": 2
  }
}
```

---

### Example 4: High ELO but Under Threshold (ELO 1800)
**Request:**
```json
{
  "type": "analyze",
  "payload": {
    "user": {
      "targetElo": 1800,
      "personality": "Human",
      "multiPV": 3,
      "disableLimitStrength": true  // ← Requested, but ELO < 2000
    }
  }
}
```

**Server Processing:**

```
Phase C: Suggestions at ELO 1800
├─ targetElo: 1800
├─ disableLimitStrength: true  ⚠️  (requested)
├─ Computed: shouldLimitStrength = true  ✓ (1800 < 2000 threshold)
├─ UCI_LimitStrength: true  ✓  STILL LIMITED
├─ UCI_Elo: 1800  ✓  (enforced below 2000)
├─ Personality: Human
├─ Hash: 192 MB
├─ Movetime: 800ms
└─ Result: 3 suggestions at ~1800 strength
```

**Response settingsUsed:**
```json
{
  "suggestion": {
    "hashMB": 192,
    "limitStrength": true,      // ← STILL LIMITED (below 2000)
    "targetElo": 1800,
    "personality": "Human",
    "multiPV": 3
  }
}
```

**Note**: The toggle is only visible in the UI when `targetElo >= 2000`, preventing this scenario.

---

## Logic Flow

```typescript
// Server-side logic in analyze-pipeline.ts (Phase C)

function phaseC_UserModeSuggestions(
  targetElo: number,
  disableLimitStrength: boolean | undefined,
  ...
) {
  // Calculate if we should limit strength
  const shouldLimitStrength = !(disableLimitStrength && targetElo >= 2000);

  // Configure engine
  engine.sendCommand(`setoption name UCI_LimitStrength value ${shouldLimitStrength ? 'true' : 'false'}`);

  if (shouldLimitStrength) {
    engine.setElo(targetElo);  // Only set ELO when limiting
  }

  // ... continue with analysis
}
```

## Truth Table

| targetElo | disableLimitStrength | shouldLimitStrength | UCI_LimitStrength | UCI_Elo Set | Effective Strength |
|-----------|---------------------|---------------------|-------------------|-------------|-------------------|
| 800       | false               | **true**            | true              | 800         | ~800 ELO          |
| 800       | true                | **true**            | true              | 800         | ~800 ELO          |
| 1500      | false               | **true**            | true              | 1500        | ~1500 ELO         |
| 1500      | true                | **true**            | true              | 1500        | ~1500 ELO         |
| 1800      | false               | **true**            | true              | 1800        | ~1800 ELO         |
| 1800      | true                | **true**            | true              | 1800        | ~1800 ELO         |
| 2000      | false               | **true**            | true              | 2000        | ~2000 ELO         |
| 2000      | true                | **false** ✨        | false             | -           | ~3200 ELO (full)  |
| 2500      | false               | **true**            | true              | 2500        | ~2500 ELO         |
| 2500      | true                | **false** ✨        | false             | -           | ~3200 ELO (full)  |
| 3000      | false               | **true**            | true              | 3000        | ~3000 ELO         |
| 3000      | true                | **false** ✨        | false             | -           | ~3200 ELO (full)  |

**Legend:**
- ✨ = Full strength mode activated
- Empty `-` = Not set when full strength is enabled

---

## Performance Characteristics

### Hash Size Allocation (by ELO)
```
ELO 300-800:   64 MB
ELO 900-1400:  128 MB
ELO 1500-1900: 192 MB
ELO 2000+:     256 MB
```

### Movetime Allocation (by ELO)
```
ELO 300-800:   200-400 ms
ELO 900-1400:  500-700 ms
ELO 1500-1900: 800-1000 ms
ELO 2000+:     1000-1500 ms
```

---

## UI Behavior

### Frontend Toggle Visibility
```typescript
// Sidebar.tsx
{localElo >= 2000 && (
  <div className="full-strength-toggle">
    <Switch
      checked={settings.disableLimitStrength}
      onCheckedChange={(checked) => setSettings({ disableLimitStrength: checked })}
    />
  </div>
)}
```

- **ELO < 2000**: Toggle hidden, always limited
- **ELO >= 2000**: Toggle visible, user can choose

---

## Summary

1. **Phase A (Accuracy)**: Always full strength regardless of settings
2. **Phase C (Suggestions)**:
   - Default: Limited to `targetElo`
   - If `targetElo >= 2000` AND `disableLimitStrength = true`: **Full strength**
3. **Threshold**: 2000 ELO minimum to unlock full strength mode
4. **Response**: Always includes actual `limitStrength` value used

This design ensures:
- ✅ Accurate performance evaluation (Phase A always full strength)
- ✅ Appropriate suggestions for lower-rated players (always limited below 2000)
- ✅ Advanced players can request maximum-strength analysis (2000+ with toggle)
- ✅ Transparent reporting of actual settings used
