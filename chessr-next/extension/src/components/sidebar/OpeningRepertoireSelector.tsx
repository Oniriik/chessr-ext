/**
 * OpeningRepertoireSelector - Select openings for White and Black
 *
 * Features:
 * - Display current White/Black opening selection
 * - Search by name or first move
 * - Select as White or Black opening
 * - Show winrate bar with stats
 */

import { useEffect, useState, useCallback } from 'react';
import { Search, Loader2, X, Check } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { useOpeningStore, type SavedOpening } from '../../stores/openingStore';
import {
  searchOpenings,
  getOpeningsWithStats,
  type OpeningWithStats,
} from '../../lib/openingsDatabase';
import { logger } from '../../lib/logger';

// ============================================
// POPULAR OPENINGS (Default display, no API needed)
// ============================================

const POPULAR_OPENINGS: OpeningWithStats[] = [
  // 4 White openings
  {
    eco: 'C50',
    name: 'Italian Game',
    fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3',
    moves: '1. e4 e5 2. Nf3 Nc6 3. Bc4',
    firstMove: 'e4',
    category: 'white',
    whiteWinRate: 54,
    drawRate: 24,
    blackWinRate: 22,
    totalGames: 1800000,
  },
  {
    eco: 'C60',
    name: 'Ruy Lopez',
    fen: 'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3',
    moves: '1. e4 e5 2. Nf3 Nc6 3. Bb5',
    firstMove: 'e4',
    category: 'white',
    whiteWinRate: 54,
    drawRate: 26,
    blackWinRate: 20,
    totalGames: 1100000,
  },
  {
    eco: 'D06',
    name: "Queen's Gambit",
    fen: 'rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR b KQkq c3 0 2',
    moves: '1. d4 d5 2. c4',
    firstMove: 'd4',
    category: 'white',
    whiteWinRate: 55,
    drawRate: 26,
    blackWinRate: 19,
    totalGames: 1500000,
  },
  {
    eco: 'D00',
    name: 'London System',
    fen: 'rnbqkbnr/ppp1pppp/8/3p4/3P1B2/8/PPP1PPPP/RN1QKBNR b KQkq - 1 2',
    moves: '1. d4 d5 2. Bf4',
    firstMove: 'd4',
    category: 'white',
    whiteWinRate: 53,
    drawRate: 28,
    blackWinRate: 19,
    totalGames: 800000,
  },
  // 4 Black openings
  {
    eco: 'B20',
    name: 'Sicilian Defense',
    fen: 'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2',
    moves: '1. e4 c5',
    firstMove: 'c5',
    category: 'black-e4',
    whiteWinRate: 52,
    drawRate: 25,
    blackWinRate: 23,
    totalGames: 2500000,
  },
  {
    eco: 'C00',
    name: 'French Defense',
    fen: 'rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
    moves: '1. e4 e6',
    firstMove: 'e6',
    category: 'black-e4',
    whiteWinRate: 51,
    drawRate: 27,
    blackWinRate: 22,
    totalGames: 1200000,
  },
  {
    eco: 'B10',
    name: 'Caro-Kann Defense',
    fen: 'rnbqkbnr/pp1ppppp/2p5/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
    moves: '1. e4 c6',
    firstMove: 'c6',
    category: 'black-e4',
    whiteWinRate: 50,
    drawRate: 28,
    blackWinRate: 22,
    totalGames: 900000,
  },
  {
    eco: 'E60',
    name: "King's Indian Defense",
    fen: 'rnbqkb1r/pppppp1p/5np1/8/2PP4/8/PP2PPPP/RNBQKBNR w KQkq - 0 3',
    moves: '1. d4 Nf6 2. c4 g6',
    firstMove: 'Nf6',
    category: 'black-d4',
    whiteWinRate: 52,
    drawRate: 26,
    blackWinRate: 22,
    totalGames: 700000,
  },
];

// ============================================
// MOVE CHIPS (like suggested moves PV display)
// ============================================

function MoveChips({ moves }: { moves: string }) {
  // Parse moves like "1. e4 c5" or "1. e4 e5 2. Nf3 Nc6 3. Bc4"
  // Extract individual moves (ignore move numbers)
  const moveList = moves
    .replace(/\d+\.\s*/g, '') // Remove move numbers like "1. " or "2. "
    .split(/\s+/)
    .filter(m => m.length > 0);

  return (
    <div className="tw-flex tw-items-center tw-gap-1 tw-flex-wrap">
      {moveList.map((move, i) => {
        const isWhiteMove = i % 2 === 0;
        return (
          <span
            key={i}
            className="tw-inline-flex tw-items-center tw-gap-0.5 tw-text-[10px] tw-px-1 tw-py-0.5 tw-rounded tw-bg-muted tw-text-muted-foreground tw-font-mono"
          >
            <span className={`tw-w-1.5 tw-h-1.5 tw-rounded-full ${isWhiteMove ? 'tw-bg-white' : 'tw-bg-gray-600'}`} />
            {move}
          </span>
        );
      })}
    </div>
  );
}

// ============================================
// WINRATE BAR
// ============================================

function WinRateBar({ white, draw, black }: { white: number; draw: number; black: number }) {
  return (
    <div className="tw-flex tw-items-center tw-gap-2">
      <div className="tw-flex tw-h-2 tw-rounded-full tw-overflow-hidden tw-bg-muted tw-flex-1">
        <div className="tw-bg-white tw-border-r tw-border-border/30" style={{ width: `${white}%` }} />
        <div className="tw-bg-zinc-400" style={{ width: `${draw}%` }} />
        <div className="tw-bg-zinc-800" style={{ width: `${black}%` }} />
      </div>
      <div className="tw-flex tw-gap-2 tw-text-xs tw-flex-shrink-0">
        <span className="tw-text-white/80">{white.toFixed(0)}%</span>
        <span className="tw-text-zinc-400">{draw.toFixed(0)}%</span>
        <span className="tw-text-zinc-500">{black.toFixed(0)}%</span>
      </div>
    </div>
  );
}

// ============================================
// SELECTED OPENING DISPLAY
// ============================================

interface SelectedOpeningProps {
  label: string;
  opening: SavedOpening | null;
  onClear: () => void;
  color: 'white' | 'black';
}

function SelectedOpening({ label, opening, onClear, color }: SelectedOpeningProps) {
  const bgColor = color === 'white' ? 'tw-bg-white' : 'tw-bg-zinc-800';

  return (
    <div className="tw-flex-1 tw-min-w-0">
      <div className="tw-flex tw-items-center tw-gap-2 tw-mb-1">
        <div className={`tw-w-4 tw-h-4 tw-rounded-sm ${bgColor} tw-border tw-border-border`} />
        <span className="tw-text-xs tw-text-white">{label}</span>
      </div>
      {opening ? (
        <div className="tw-px-2 tw-py-1.5 tw-rounded-md tw-bg-muted/50 tw-border tw-border-border/50">
          <div className="tw-flex tw-items-center tw-gap-1">
            <Badge variant="outline" className="tw-font-mono tw-text-xs tw-flex-shrink-0">
              {opening.eco}
            </Badge>
            <span className="tw-text-xs tw-truncate">{opening.name}</span>
            <Button
              variant="ghost"
              size="icon"
              className="tw-h-4 tw-w-4 tw-flex-shrink-0 tw-ml-auto"
              onClick={onClear}
            >
              <X className="tw-h-3 tw-w-3" />
            </Button>
          </div>
          <div className="tw-mt-1">
            <MoveChips moves={opening.moves} />
          </div>
        </div>
      ) : (
        <div className="tw-flex tw-items-center tw-px-2 tw-py-3 tw-rounded-md tw-bg-muted/30 tw-border tw-border-dashed tw-border-border/50">
          <span className="tw-text-xs tw-text-muted-foreground tw-italic">Not selected</span>
        </div>
      )}
    </div>
  );
}

// ============================================
// OPENING RESULT ROW
// ============================================

interface OpeningRowProps {
  opening: OpeningWithStats;
  isWhiteSelected: boolean;
  isBlackSelected: boolean;
  onSelectWhite: () => void;
  onSelectBlack: () => void;
}

function OpeningRow({
  opening,
  isWhiteSelected,
  isBlackSelected,
  onSelectWhite,
  onSelectBlack,
}: OpeningRowProps) {
  const formatGames = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
    return n.toString();
  };

  // Determine which colors are compatible with this opening
  const isWhiteCompatible = opening.category === 'white';
  const isBlackCompatible = opening.category?.startsWith('black-') ?? false;

  return (
    <div className="tw-p-2 tw-rounded-md tw-bg-muted/30 hover:tw-bg-muted/50 tw-transition-colors">
      {/* Line 1: Name, games count, select buttons */}
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-2 tw-mb-2">
        <div className="tw-flex tw-items-center tw-gap-2 tw-flex-1 tw-min-w-0">
          <Badge variant="outline" className="tw-font-mono tw-text-xs tw-flex-shrink-0">
            {opening.eco}
          </Badge>
          <span className="tw-text-sm tw-truncate">{opening.name}</span>
        </div>
        <div className="tw-flex tw-items-center tw-gap-2 tw-flex-shrink-0">
          <span className="tw-text-xs tw-text-muted-foreground">
            {formatGames(opening.totalGames)}
          </span>
          <Button
            variant={isWhiteSelected ? 'default' : 'outline'}
            size="sm"
            className="tw-h-7 tw-px-2 tw-text-xs"
            onClick={onSelectWhite}
            disabled={!isWhiteCompatible}
            title={isWhiteCompatible ? "Select as White opening" : "This opening is for Black only"}
          >
            {isWhiteSelected ? <Check className="tw-h-3 tw-w-3 tw-mr-1" /> : null}
            W
          </Button>
          <Button
            variant={isBlackSelected ? 'default' : 'outline'}
            size="sm"
            className="tw-h-7 tw-px-2 tw-text-xs"
            onClick={onSelectBlack}
            disabled={!isBlackCompatible}
            title={isBlackCompatible ? "Select as Black opening" : "This opening is for White only"}
          >
            {isBlackSelected ? <Check className="tw-h-3 tw-w-3 tw-mr-1" /> : null}
            B
          </Button>
        </div>
      </div>

      {/* Line 2: Winrate bar */}
      <WinRateBar
        white={opening.whiteWinRate}
        draw={opening.drawRate}
        black={opening.blackWinRate}
      />

      {/* Line 3: Moves */}
      <div className="tw-mt-1">
        <MoveChips moves={opening.moves} />
      </div>
    </div>
  );
}

// ============================================
// MAIN COMPONENT
// ============================================

// White first moves for counter detection
const WHITE_MOVES = ['e4', 'd4', 'c4', 'nf3', 'g3', 'b3', 'f4'];

export function OpeningRepertoireSelector() {
  const { repertoire, setWhiteOpening, setBlackOpening } = useOpeningStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [colorFilter, setColorFilter] = useState<'white' | 'black' | null>(null);
  const [counterMode, setCounterMode] = useState(false);
  const [results, setResults] = useState<OpeningWithStats[]>(POPULAR_OPENINGS);
  const [isLoading, setIsLoading] = useState(false);
  const [isWhiteSearch, setIsWhiteSearch] = useState(false);

  // Detect if search is for a white move or white opening
  const normalizedQuery = searchQuery.toLowerCase().trim();
  const isWhiteMoveSearch = WHITE_MOVES.includes(normalizedQuery);

  // Counter is only enabled for white move searches or when we detected white openings
  const canUseCounter = isWhiteMoveSearch || isWhiteSearch;

  // Reset counter mode when it becomes unavailable
  useEffect(() => {
    if (!canUseCounter) {
      setCounterMode(false);
    }
  }, [canUseCounter]);

  // Search openings
  useEffect(() => {
    // Clear results immediately when filters change (before debounce)
    setResults([]);
    setIsLoading(true);

    if (!searchQuery.trim()) {
      // No search: apply color filter to popular openings
      let filtered = POPULAR_OPENINGS;
      if (colorFilter === 'white') {
        filtered = POPULAR_OPENINGS.filter(o => o.category === 'white');
      } else if (colorFilter === 'black') {
        filtered = POPULAR_OPENINGS.filter(o => o.category?.startsWith('black-'));
      }
      setResults(filtered);
      setIsLoading(false);
      setIsWhiteSearch(false);
      return;
    }

    let cancelled = false;
    const timeoutId = setTimeout(async () => {

      try {
        // Search across all categories
        const openings = await searchOpenings(searchQuery, { limit: 30 });

        if (cancelled) return;

        // Check if search contains white openings (for counter button)
        const hasWhiteOpenings = openings.some(o => o.category === 'white');
        setIsWhiteSearch(hasWhiteOpenings && !isWhiteMoveSearch);

        // Determine which openings to show
        let filtered = openings;

        // Check if query looks like a move (2-4 chars, letters/numbers)
        const looksLikeMove = /^[a-h]?[1-8]?[a-h][1-8]?$|^[nbrqk][a-h]?[1-8]?$/i.test(normalizedQuery);

        if (counterMode && (isWhiteMoveSearch || hasWhiteOpenings)) {
          // Counter mode: show black openings that counter the white move/opening
          if (isWhiteMoveSearch) {
            // Search for white move like "e4" -> show black-e4 responses
            filtered = openings.filter(o => o.category === `black-${normalizedQuery}`);
          } else {
            // Search for white opening name -> show black responses to that opening's first move
            const whiteOpening = openings.find(o => o.category === 'white');
            if (whiteOpening) {
              const firstMove = whiteOpening.firstMove.toLowerCase();
              filtered = openings.filter(o => o.category === `black-${firstMove}`);
              // If no direct match, search for black openings separately
              if (filtered.length === 0) {
                const blackOpenings = await searchOpenings(firstMove, { limit: 30 });
                filtered = blackOpenings.filter(o => o.category?.startsWith('black-'));
              }
            }
          }
        } else if (colorFilter === 'white') {
          // White filter: only white openings
          filtered = openings.filter(o => o.category === 'white');
          // If searching for a move, also filter by firstMove
          if (looksLikeMove) {
            filtered = filtered.filter(o => o.firstMove.toLowerCase() === normalizedQuery);
          }
        } else if (colorFilter === 'black') {
          // Black filter: only black openings
          filtered = openings.filter(o => o.category?.startsWith('black-'));
          // If searching for a move, also filter by firstMove (black's response)
          if (looksLikeMove) {
            filtered = filtered.filter(o => o.firstMove.toLowerCase() === normalizedQuery);
          }
        }

        if (cancelled) return;

        // Get winrates from Lichess
        const withStats = await getOpeningsWithStats(filtered.slice(0, 10));

        if (cancelled) return;

        // Sort by winrate based on the search context
        // IMPORTANT: counterMode MUST be checked FIRST - always sort by black winrate in counter mode
        const sorted = [...withStats].sort((a, b) => {
          if (counterMode) {
            // Counter mode: ALWAYS sort by black winrate (best counters to white)
            return b.blackWinRate - a.blackWinRate;
          }

          if (colorFilter === 'white') {
            return b.whiteWinRate - a.whiteWinRate;
          }

          if (colorFilter === 'black') {
            return b.blackWinRate - a.blackWinRate;
          }

          if (isWhiteMoveSearch) {
            // Searching a white move (e4, d4, etc.) -> sort by white winrate
            return b.whiteWinRate - a.whiteWinRate;
          }

          if (normalizedQuery) {
            // Searching something else (black move like e5, c5, or opening name)
            // If results are black openings, sort by black winrate
            const aIsBlack = a.category?.startsWith('black-');
            const bIsBlack = b.category?.startsWith('black-');
            if (aIsBlack && bIsBlack) {
              return b.blackWinRate - a.blackWinRate;
            }
            if (!aIsBlack && !bIsBlack) {
              return b.whiteWinRate - a.whiteWinRate;
            }
            // Mixed: sort by relevant winrate
            const aRate = aIsBlack ? a.blackWinRate : a.whiteWinRate;
            const bRate = bIsBlack ? b.blackWinRate : b.whiteWinRate;
            return bRate - aRate;
          }

          // Default: sort by best winrate
          return Math.max(b.whiteWinRate, b.blackWinRate) - Math.max(a.whiteWinRate, a.blackWinRate);
        });

        setResults(sorted);
      } catch (error) {
        logger.error('[openings] Search failed:', error);
        setResults([]);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }, 500); // Debounce

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [searchQuery, colorFilter, counterMode, normalizedQuery, isWhiteMoveSearch]);

  const handleSelectWhite = useCallback(
    (opening: OpeningWithStats) => {
      const saved: SavedOpening = {
        name: opening.name,
        moves: opening.moves,
        eco: opening.eco,
        totalGames: opening.totalGames,
      };
      setWhiteOpening(saved);
    },
    [setWhiteOpening]
  );

  const handleSelectBlack = useCallback(
    (opening: OpeningWithStats) => {
      const saved: SavedOpening = {
        name: opening.name,
        moves: opening.moves,
        eco: opening.eco,
        totalGames: opening.totalGames,
      };
      setBlackOpening(saved);
    },
    [setBlackOpening]
  );

  const handleClearWhite = useCallback(() => {
    setWhiteOpening(null);
  }, [setWhiteOpening]);

  const handleClearBlack = useCallback(() => {
    setBlackOpening(null);
  }, [setBlackOpening]);

  return (
    <Card className="tw-bg-muted/50">
      <CardContent className="tw-p-4 tw-space-y-4">
        <span className="tw-text-sm tw-font-semibold">Opening Repertoire</span>
        {/* Current selections: White and Black side by side */}
        <div className="tw-flex tw-gap-4">
          <SelectedOpening
            label="White Open"
            opening={repertoire.white}
            onClear={handleClearWhite}
            color="white"
          />
          <SelectedOpening
            label="Black Open"
            opening={repertoire.black}
            onClear={handleClearBlack}
            color="black"
          />
        </div>

        {/* Search bar with color filter */}
        <div className="tw-flex tw-gap-2">
          <div className="tw-relative tw-flex-1">
            <Search className="tw-absolute tw-left-3 tw-top-1/2 tw--translate-y-1/2 tw-h-4 tw-w-4 tw-text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Name, ECO (B20), or e4/d4"
              className="tw-pl-9 tw-pr-9 tw-h-9"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="icon"
                className="tw-absolute tw-right-1 tw-top-1/2 tw--translate-y-1/2 tw-h-7 tw-w-7"
                onClick={() => setSearchQuery('')}
              >
                <X className="tw-h-4 tw-w-4" />
              </Button>
            )}
          </div>
          <Button
            variant={counterMode ? 'default' : 'outline'}
            size="sm"
            className="tw-h-9 tw-px-2 tw-text-xs"
            onClick={() => setCounterMode(!counterMode)}
            disabled={!canUseCounter}
            title={canUseCounter ? 'Show best black counters' : 'Search a white move or opening to find counters'}
          >
            Counter
          </Button>
          <Button
            variant={colorFilter === 'white' && !counterMode ? 'default' : 'outline'}
            size="sm"
            className="tw-h-9 tw-px-2"
            onClick={() => { setColorFilter(colorFilter === 'white' ? null : 'white'); setCounterMode(false); }}
            title="Filter White openings"
          >
            W
          </Button>
          <Button
            variant={colorFilter === 'black' && !counterMode ? 'default' : 'outline'}
            size="sm"
            className="tw-h-9 tw-px-2"
            onClick={() => { setColorFilter(colorFilter === 'black' ? null : 'black'); setCounterMode(false); }}
            title="Filter Black openings"
          >
            B
          </Button>
        </div>

        {/* Search results */}
        {isLoading ? (
          <div className="tw-flex tw-items-center tw-justify-center tw-py-4">
            <Loader2 className="tw-h-5 tw-w-5 tw-animate-spin tw-text-muted-foreground" />
          </div>
        ) : results.length === 0 ? (
          <p className="tw-text-sm tw-text-muted-foreground tw-text-center tw-py-4">
            No openings found for "{searchQuery}"
          </p>
        ) : (
          <div className="tw-space-y-2 tw-max-h-72 tw-overflow-y-auto">
            {results.map((opening) => (
              <OpeningRow
                key={`${opening.eco}-${opening.name}`}
                opening={opening}
                isWhiteSelected={repertoire.white?.eco === opening.eco}
                isBlackSelected={repertoire.black?.eco === opening.eco}
                onSelectWhite={() => handleSelectWhite(opening)}
                onSelectBlack={() => handleSelectBlack(opening)}
              />
            ))}
          </div>
        )}

        {/* Legend */}
        {results.length > 0 && (
          <div className="tw-flex tw-items-center tw-justify-center tw-gap-3 tw-text-xs tw-text-muted-foreground tw-pt-2 tw-border-t tw-border-border">
            <span className="tw-flex tw-items-center tw-gap-1">
              <div className="tw-w-2 tw-h-2 tw-rounded-full tw-bg-white tw-border tw-border-border/50" />
              White wins
            </span>
            <span className="tw-flex tw-items-center tw-gap-1">
              <div className="tw-w-2 tw-h-2 tw-rounded-full tw-bg-zinc-400" />
              Draw
            </span>
            <span className="tw-flex tw-items-center tw-gap-1">
              <div className="tw-w-2 tw-h-2 tw-rounded-full tw-bg-zinc-800" />
              Black wins
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
