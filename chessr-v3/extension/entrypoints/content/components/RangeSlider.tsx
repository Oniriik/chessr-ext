import { useRef, useCallback } from 'react';
import './slider.css';

interface Props {
  min: number;
  max: number;
  step: number;
  value: [number, number];
  onChange: (v: [number, number]) => void;
  color?: string;
  disabled?: boolean;
}

export default function RangeSlider({ min, max, step, value, onChange, color = '#3b82f6', disabled }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<'min' | 'max' | null>(null);

  const [lo, hi] = value;
  const range = max - min;
  const pctLo = range > 0 ? Math.max(0, Math.min(100, ((lo - min) / range) * 100)) : 0;
  const pctHi = range > 0 ? Math.max(0, Math.min(100, ((hi - min) / range) * 100)) : 100;

  const update = useCallback((clientX: number) => {
    if (!trackRef.current || !dragging.current || disabled) return;
    const rect = trackRef.current.getBoundingClientRect();
    const raw = (clientX - rect.left) / rect.width;
    const clamped = Math.max(0, Math.min(1, raw));
    const stepped = Math.round((clamped * range) / step) * step + min;
    const v = Math.max(min, Math.min(max, stepped));
    if (dragging.current === 'min') onChange([Math.min(v, hi), hi]);
    else onChange([lo, Math.max(v, lo)]);
  }, [min, max, step, range, lo, hi, onChange, disabled]);

  const startDrag = (which: 'min' | 'max') => (e: React.PointerEvent) => {
    if (disabled) return;
    dragging.current = which;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.stopPropagation();
  };

  const onPointerDownTrack = useCallback((e: React.PointerEvent) => {
    if (disabled || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const raw = (e.clientX - rect.left) / rect.width;
    const clamped = Math.max(0, Math.min(1, raw));
    const v = Math.round((clamped * range) / step) * step + min;
    // Pick the closest thumb
    dragging.current = Math.abs(v - lo) <= Math.abs(v - hi) ? 'min' : 'max';
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    update(e.clientX);
  }, [disabled, min, range, step, lo, hi, update]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (dragging.current) update(e.clientX);
  }, [update]);

  const onPointerUp = useCallback(() => {
    dragging.current = null;
  }, []);

  return (
    <div
      ref={trackRef}
      className={`cslider ${disabled ? 'cslider--disabled' : ''}`}
      onPointerDown={onPointerDownTrack}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div className="cslider-track" style={{ background: 'rgba(255, 255, 255, 0.08)', opacity: 1 }} />
      <div
        className="cslider-fill"
        style={{
          width: '100%',
          background: color,
          clipPath: `inset(0 ${100 - pctHi}% 0 ${pctLo}%)`,
        }}
      />
      <div
        className="cslider-thumb"
        style={{ left: `${pctLo}%`, background: color }}
        onPointerDown={startDrag('min')}
      />
      <div
        className="cslider-thumb"
        style={{ left: `${pctHi}%`, background: color }}
        onPointerDown={startDrag('max')}
      />
    </div>
  );
}
