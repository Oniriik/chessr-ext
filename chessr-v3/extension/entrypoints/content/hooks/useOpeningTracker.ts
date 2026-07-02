import { useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { useGameStore } from '../stores/gameStore';
import { useAuthStore } from '../stores/authStore';
import { isPremium } from '../lib/premium';
import { useOpeningStore, type SelectedOpening } from '../stores/openingStore';
import { queryGame, type NextMove } from '../lib/openingApi';
import { setTheoryArrow, clearTheoryArrow, setDeviationArrow, clearDeviationArrow } from '../lib/arrows';

export type TrackerPhase =
  | { type: 'none' }
  | { type: 'start'; openings: SelectedOpening[] }
  | { type: 'narrowing'; openings: SelectedOpening[] }
  | { type: 'in_book'; opening: SelectedOpening; nextMove: string | null }
  | { type: 'opp_deviated'; opening: SelectedOpening; deviationMove: string; theoryMove: string | null; bookReply: NextMove | null }
  | { type: 'player_deviated'; opening: SelectedOpening; nextMove: string | null; bookReply: NextMove | null }
  | { type: 'no_match'; bookReply: NextMove | null };

function isOpeningViable(gameMoves: string[], openingUci: string): boolean {
  const openingMoves = openingUci.split(' ');
  const len = Math.min(gameMoves.length, openingMoves.length);
  for (let i = 0; i < len; i++) {
    if (gameMoves[i] !== openingMoves[i]) return false;
  }
  return true;
}

/** Replay `history` then check that `uci` is a legal move in the resulting
 *  position. Used to decide whether the player's planned opening move is
 *  still playable after the opponent deviated. */
function isUciLegal(history: string[], uci: string): boolean {
  try {
    const c = new Chess();
    for (const m of history) {
      c.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m.slice(4) || undefined });
    }
    return !!c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
  } catch {
    return false;
  }
}

export function useOpeningTracker(): TrackerPhase {
  const moves = useGameStore((s) => s.moveHistoryUci);
  const playerColor = useGameStore((s) => s.playerColor);
  const plan = useAuthStore((s) => s.plan);
  const selectedOpenings = useOpeningStore((s) => s.selectedOpenings);
  const theoryArrowEnabled = useOpeningStore((s) => s.theoryArrowEnabled);
  const theoryArrowColor = useOpeningStore((s) => s.theoryArrowColor);
  const deviationArrowEnabled = useOpeningStore((s) => s.deviationArrowEnabled);
  const deviationArrowColor = useOpeningStore((s) => s.deviationArrowColor);

  const [phase, setPhase] = useState<TrackerPhase>({ type: 'none' });
  // Deepest selected opening that matched the game before the deviation —
  // lets us keep tracking (and offering the plan) after viable drops to 0.
  const lockedRef = useRef<SelectedOpening | null>(null);

  useEffect(() => {
    // Premium-only feature, and white-only for now — as black you don't
    // control the opening. Both gates kill arrows + panel section.
    if (!isPremium(plan) || playerColor === 'black') {
      setPhase({ type: 'none' });
      clearTheoryArrow();
      clearDeviationArrow();
      return;
    }

    // Note: the persisted sideFilter setting is intentionally ignored —
    // opening tracking is white-only, its UI toggle was removed.
    const activeOpenings = selectedOpenings;

    if (activeOpenings.length === 0) {
      setPhase({ type: 'none' });
      clearTheoryArrow();
      clearDeviationArrow();
      return;
    }

    // Only show arrows when it's the player's turn (not while waiting for
    // opponent). White plays at even move indices, black at odd.
    const isMyTurn = playerColor === 'black' ? moves.length % 2 === 1 : moves.length % 2 === 0;

    function maybeTheory(move: string | null, label?: string) {
      if (isMyTurn && theoryArrowEnabled && move) setTheoryArrow(move, theoryArrowColor, label);
      else clearTheoryArrow();
    }
    function maybeDeviation(move: string | null, label?: string) {
      if (isMyTurn && deviationArrowEnabled && move) setDeviationArrow(move, deviationArrowColor, label);
      else clearDeviationArrow();
    }

    if (moves.length === 0) {
      lockedRef.current = null;
      setPhase({ type: 'start', openings: activeOpenings });
      clearDeviationArrow();
      // Show arrow for the first move if all active openings agree
      const firstMoves = activeOpenings.map((o) => o.uci.split(' ')[0] ?? null);
      const unique = new Set(firstMoves.filter(Boolean));
      maybeTheory(unique.size === 1 ? [...unique][0] : null, unique.size === 1 ? activeOpenings[0].name : undefined);
      return;
    }

    const viable = activeOpenings.filter((o) => isOpeningViable(moves, o.uci));

    if (viable.length > 1) {
      // Remember a fallback for the deviation flow — first viable is as
      // good as any while several lines still match.
      lockedRef.current = viable[0];
      setPhase({ type: 'narrowing', openings: viable });
      clearDeviationArrow();
      const nextMoves = viable.map((o) => o.uci.split(' ')[moves.length] ?? null);
      const unique = new Set(nextMoves.filter(Boolean));
      maybeTheory(unique.size === 1 ? [...unique][0] : null, unique.size === 1 ? viable[0].name : undefined);
      return;
    }

    if (viable.length === 1) {
      const locked = viable[0];
      lockedRef.current = locked;
      const openingMoves = locked.uci.split(' ');

      if (moves.length < openingMoves.length) {
        const nextMove = openingMoves[moves.length] ?? null;
        setPhase({ type: 'in_book', opening: locked, nextMove });
        clearDeviationArrow();
        maybeTheory(nextMove, locked.name);
        return;
      }

      // Beyond the selected line — ask the API for book continuations.
      let cancelled = false;
      queryGame(moves).then((data) => {
        if (cancelled) return;
        if (data?.inBook && data.nextMoves?.length) {
          const reply = data.nextMoves[0];
          setPhase({ type: 'in_book', opening: locked, nextMove: reply.uci });
          maybeTheory(reply.uci, reply.name);
        } else {
          setPhase({ type: 'in_book', opening: locked, nextMove: null });
          clearTheoryArrow();
        }
        clearDeviationArrow();
      });
      return () => { cancelled = true; };
    }

    // viable.length === 0 — someone left the selected opening.
    const locked = lockedRef.current;
    if (!locked) {
      // No selected opening ever matched this game (e.g. playing black and
      // the opponent opened outside the repertoire). Still guide the player
      // with the book's best reply to the position actually on the board.
      clearTheoryArrow();
      let noMatchCancelled = false;
      queryGame(moves).then((data) => {
        if (noMatchCancelled) return;
        const bookReply = data?.inBook ? (data.nextMoves?.[0] ?? null) : null;
        setPhase({ type: 'no_match', bookReply });
        maybeDeviation(bookReply?.uci ?? null, bookReply?.name);
      });
      return () => { noMatchCancelled = true; };
    }

    const lockedMoves = locked.uci.split(' ');
    let mismatch = 0;
    while (mismatch < moves.length && mismatch < lockedMoves.length && moves[mismatch] === lockedMoves[mismatch]) mismatch++;
    const playerIsWhite = playerColor !== 'black';
    const deviatorIsWhite = mismatch % 2 === 0;
    const playerDeviated = playerIsWhite === deviatorIsWhite;

    // The player's planned opening move — still offered after an opponent
    // deviation, as long as the line has one at this depth and it's legal
    // in the real position. Otherwise the plan is abandoned.
    let planned: string | null = null;
    if (!playerDeviated && isMyTurn && moves.length < lockedMoves.length) {
      const cand = lockedMoves[moves.length];
      if (cand && isUciLegal(moves, cand)) planned = cand;
    }

    let cancelled = false;
    queryGame(moves).then((data) => {
      if (cancelled) return;
      // Best book reply to the position actually on the board (the game
      // usually transposes into another known opening).
      const bookReply = data?.inBook ? (data.nextMoves?.[0] ?? null) : null;

      if (playerDeviated) {
        setPhase({ type: 'player_deviated', opening: locked, nextMove: bookReply?.uci ?? null, bookReply });
        clearTheoryArrow();
        maybeDeviation(bookReply?.uci ?? null, bookReply?.name);
      } else {
        setPhase({ type: 'opp_deviated', opening: locked, deviationMove: moves[mismatch], theoryMove: planned, bookReply });
        maybeTheory(planned, locked.name);
        // Don't double up when the book reply IS the planned move.
        const dev = bookReply && bookReply.uci !== planned ? bookReply : null;
        maybeDeviation(dev?.uci ?? null, dev?.name);
      }
    });
    return () => { cancelled = true; };
  }, [moves, selectedOpenings, theoryArrowEnabled, theoryArrowColor, deviationArrowEnabled, deviationArrowColor, playerColor, plan]);

  return phase;
}
