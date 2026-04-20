import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { useEvalStore } from '../stores/evalStore';
import { useGameStore } from '../stores/gameStore';
import { useSettingsStore } from '../stores/settingsStore';
import './eval-bar.css';

/**
 * Convert eval (pawns, white's perspective) to bar percentage.
 * 0% = full black advantage, 100% = full white advantage, 50% = equal.
 */
function evalToPercent(evalPawns: number): number {
  // Sigmoid-ish: clamp eval to roughly ±5 pawns for visual range
  const cp = evalPawns * 100;
  const pct = 50 + 50 * (2 / (1 + Math.exp(-0.004 * cp)) - 1);
  return Math.max(2, Math.min(98, pct));
}

function formatEval(evalPawns: number, mateIn: number | null, isFlipped: boolean): string {
  if (mateIn !== null) {
    // mateIn is from white's perspective: positive = white mates
    const absM = Math.abs(mateIn);
    return `M${absM}`;
  }
  const abs = Math.abs(evalPawns);
  if (abs < 0.05) return '0.0';
  return abs.toFixed(1);
}

export default function EvalBar() {
  const evalPawns = useEvalStore((s) => s.eval);
  const mateIn = useEvalStore((s) => s.mateIn);
  const playerColor = useGameStore((s) => s.playerColor);
  const isPlaying = useGameStore((s) => s.isPlaying);
  const disableAnimations = useSettingsStore((s) => s.disableAnimations);

  const barRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [mounted, setMounted] = useState(false);

  const isFlipped = playerColor === 'black';

  // Calculate fill percentage
  // The bar shows the bottom player's advantage as fill from bottom
  // White perspective: 100% = white winning fully
  // If flipped (playing black): we invert so bottom = black advantage
  let fillPct = 50;
  if (evalPawns !== null) {
    if (mateIn !== null) {
      fillPct = mateIn > 0 ? 98 : 2; // white mates or black mates
    } else {
      fillPct = evalToPercent(evalPawns);
    }
    if (isFlipped) fillPct = 100 - fillPct;
  }

  // Determine which side is winning for text color
  const whiteAdvantage = evalPawns !== null && evalPawns > 0;
  const bottomWinning = isFlipped ? !whiteAdvantage : whiteAdvantage;

  // Eval text — show on the winning side
  const evalText = evalPawns !== null ? formatEval(evalPawns, mateIn, isFlipped) : '';

  // Animate fill
  useEffect(() => {
    if (!fillRef.current) return;
    if (!mounted || disableAnimations) {
      fillRef.current.style.height = `${fillPct}%`;
      setMounted(true);
      return;
    }
    gsap.to(fillRef.current, { height: `${fillPct}%`, duration: 0.5, ease: 'power2.out' });
  }, [fillPct, disableAnimations]);

  // Find the board and position the bar
  useEffect(() => {
    if (!barRef.current) return;
    const board = document.querySelector('wc-chess-board') as HTMLElement;
    if (!board) return;

    const position = () => {
      const rect = board.getBoundingClientRect();
      if (barRef.current) {
        barRef.current.style.top = `${rect.top + window.scrollY}px`;
        barRef.current.style.left = `${rect.left - 24 + window.scrollX}px`;
        barRef.current.style.height = `${rect.height}px`;
        barRef.current.style.display = 'flex';
      }
    };

    position();

    const observer = new ResizeObserver(position);
    observer.observe(board);
    window.addEventListener('scroll', position);

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', position);
    };
  }, [isPlaying]);

  if (!isPlaying || evalPawns === null) return null;

  return (
    <div ref={barRef} className="eval-bar">
      {/* White fill from bottom */}
      <div ref={fillRef} className="eval-bar-fill" style={{ height: `${fillPct}%` }} />

      {/* Eval text — positioned at top or bottom depending on who's winning */}
      <span
        ref={textRef}
        className={`eval-bar-text ${bottomWinning ? 'eval-bar-text--bottom' : 'eval-bar-text--top'}`}
      >
        {evalText}
      </span>
    </div>
  );
}
