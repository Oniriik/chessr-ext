import { useEffect, useRef, useMemo } from 'react';
import gsap from 'gsap';
import {
  useAccuracy,
  useAccuracyTrend,
  useIsAnalyzing,
  useMoveAnalyses,
  computeClassificationCounts,
  type AccuracyTrend,
} from '../stores/analysisStore';
import type { MoveClassification } from '../lib/moveAnalysis';
import { useSettingsStore } from '../stores/settingsStore';
import { animationGate } from '../stores/animationStore';
import './performance-card.css';

const CLASSIFICATION_CONFIG: {
  key: MoveClassification;
  label: string;
  full: string;
  color: string;
}[] = [
  { key: 'best',       label: 'Best',  full: 'Best',       color: '#22c55e' },
  { key: 'excellent',  label: 'Exce',  full: 'Excellent',  color: '#6ee7b7' },
  { key: 'good',       label: 'Good',  full: 'Good',       color: '#94a3b8' },
  { key: 'inaccuracy', label: 'Inacc', full: 'Inaccuracy', color: '#fbbf24' },
  { key: 'mistake',    label: 'Miss',  full: 'Mistake',    color: '#fb923c' },
  { key: 'blunder',    label: 'Blund', full: 'Blunder',    color: '#f87171' },
];

function getAccuracyColor(accuracy: number): string {
  if (accuracy >= 90) return '#22c55e';
  if (accuracy >= 70) return '#38bdf8';
  if (accuracy >= 50) return '#fbbf24';
  return '#f87171';
}

function getAccuracyBg(accuracy: number): string {
  if (accuracy >= 90) return 'rgba(34, 197, 94, 0.1)';
  if (accuracy >= 70) return 'rgba(56, 189, 248, 0.1)';
  if (accuracy >= 50) return 'rgba(251, 191, 36, 0.1)';
  return 'rgba(248, 113, 113, 0.1)';
}

function getAccuracyRing(accuracy: number): string {
  if (accuracy >= 90) return '1px solid rgba(34, 197, 94, 0.25)';
  if (accuracy >= 70) return '1px solid rgba(56, 189, 248, 0.25)';
  if (accuracy >= 50) return '1px solid rgba(251, 191, 36, 0.25)';
  return '1px solid rgba(248, 113, 113, 0.25)';
}

function trendLabel(trend: AccuracyTrend): string {
  if (trend === 'up') return 'improving';
  if (trend === 'down') return 'declining';
  return 'stable';
}

function trendColor(trend: AccuracyTrend): string {
  if (trend === 'up') return '#22c55e';
  if (trend === 'down') return '#f87171';
  return '#71717a';
}

function trendRotation(trend: AccuracyTrend): number {
  if (trend === 'up') return -90;
  if (trend === 'down') return 90;
  return 0;
}

export default function PerformanceCard() {
  const accuracy = useAccuracy();
  const trend = useAccuracyTrend();
  const isAnalyzing = useIsAnalyzing();
  const moveAnalyses = useMoveAnalyses();
  const disableAnimations = useSettingsStore((s) => s.disableAnimations);

  const numberRef = useRef<HTMLSpanElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);
  const displayedValue = useRef({ val: accuracy });
  const breatheTween = useRef<gsap.core.Tween | null>(null);
  const arrowRef = useRef<SVGSVGElement>(null);
  const trendLabelRef = useRef<HTMLSpanElement>(null);
  const prevTrend = useRef<AccuracyTrend | null>(null);

  const counts = useMemo(
    () => computeClassificationCounts(moveAnalyses),
    [moveAnalyses],
  );

  const moveCount = moveAnalyses.length;
  const idle = moveCount === 0;
  const shouldAnimateAnalysis = !idle && animationGate.consumeEvent('analysis', 'panel-perf');
  const color = getAccuracyColor(accuracy);

  // Animate accuracy number with GSAP — only on real analysis events
  useEffect(() => {
    if (idle || !numberRef.current) return;

    if (!shouldAnimateAnalysis || displayedValue.current.val === accuracy) {
      displayedValue.current.val = accuracy;
      numberRef.current.textContent = Math.round(accuracy).toString();
      return;
    }

    gsap.to(displayedValue.current, {
      val: accuracy,
      duration: 0.6,
      ease: 'power2.out',
      onUpdate: () => {
        if (numberRef.current) {
          numberRef.current.textContent = Math.round(displayedValue.current.val).toString();
        }
      },
    });
  }, [accuracy, idle, disableAnimations]);

  // Breathe effect on accuracy badge while analyzing
  useEffect(() => {
    if (!badgeRef.current) return;

    if (isAnalyzing && !idle && !disableAnimations) {
      breatheTween.current = gsap.to(badgeRef.current, {
        opacity: 0.5,
        duration: 0.8,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1,
      });
    } else {
      if (breatheTween.current) {
        breatheTween.current.kill();
        breatheTween.current = null;
      }
      if (badgeRef.current) {
        gsap.set(badgeRef.current, { opacity: 1 });
      }
    }

    return () => {
      if (breatheTween.current) {
        breatheTween.current.kill();
        breatheTween.current = null;
      }
    };
  }, [isAnalyzing, idle, disableAnimations]);

  // Animate arrow rotation + color on trend change
  useEffect(() => {
    if (idle) return;
    const isFirst = prevTrend.current === null;
    prevTrend.current = trend;

    const rot = trendRotation(trend);
    const col = trendColor(trend);
    const dur = isFirst || disableAnimations ? 0 : 0.4;

    if (arrowRef.current) {
      gsap.to(arrowRef.current, { rotation: rot, duration: dur, ease: 'power2.out' });
      gsap.to(arrowRef.current, { color: col, duration: dur });
    }
    if (trendLabelRef.current) {
      trendLabelRef.current.textContent = trendLabel(trend);
      if (!isFirst && !disableAnimations) {
        gsap.fromTo(trendLabelRef.current,
          { opacity: 0 },
          { opacity: 1, duration: 0.25 },
        );
      }
    }
  }, [trend, idle, disableAnimations]);

  return (
    <div className="perf-card">
      <div className="perf-header">
        <span className="perf-header-label">Performance</span>
        <span className={`perf-header-moves ${idle ? 'perf-header-moves--idle' : ''}`}>
          {idle ? 'Ready' : `${moveCount} moves`}
        </span>
      </div>

      <div className="perf-body">
        <div
          ref={badgeRef}
          className={`perf-accuracy ${idle ? 'perf-accuracy--idle' : ''}`}
          style={idle ? {} : { background: getAccuracyBg(accuracy), outline: getAccuracyRing(accuracy) }}
        >
          <div className="perf-accuracy-value">
            {idle ? (
              <span className="perf-accuracy-number perf-accuracy-number--idle">{'\u2014'}</span>
            ) : (
              <>
                <span ref={numberRef} className="perf-accuracy-number" style={{ color }}>
                  {Math.round(accuracy)}
                </span>
                <span className="perf-accuracy-pct" style={{ color }}>%</span>
              </>
            )}
          </div>
          <div className="perf-accuracy-status">
            {idle ? (
              <span className="perf-accuracy-trend-placeholder">&nbsp;</span>
            ) : (
              <div className="perf-accuracy-trend">
                <svg
                  ref={arrowRef}
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  style={{ color: trendColor(trend), transform: `rotate(${trendRotation(trend)}deg)` }}
                >
                  <path d="M3 1.5L7 5L3 8.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span ref={trendLabelRef}>{trendLabel(trend)}</span>
              </div>
            )}
          </div>
        </div>

        <div className="perf-grid">
          {CLASSIFICATION_CONFIG.map(({ key, label, full, color: clsColor }) => {
            const count = idle ? 0 : counts[key];
            return (
              <div key={key} className={`perf-cls ${count > 0 ? 'perf-cls--active' : ''}`} data-tooltip={full}>
                <span
                  className="perf-cls-count"
                  style={{ color: idle ? 'hsl(var(--muted-foreground) / 0.4)' : clsColor }}
                >
                  {count}
                </span>
                <span className="perf-cls-label">{label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
