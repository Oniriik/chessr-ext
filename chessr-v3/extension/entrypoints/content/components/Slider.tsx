import { useRef, useCallback } from 'react';
import './slider.css';

interface SliderProps {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  trackColor?: string;
  thumbColor?: string;
  thumbColorEnd?: string;
  thumbColorFn?: (pct: number) => string; // custom function: pct 0-100 → color string
  glowColor?: string;
}

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

export function lerpColor(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const bl = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

export default function Slider({ min, max, step, value, onChange, disabled, trackColor, thumbColor = '#3b82f6', thumbColorEnd, thumbColorFn, glowColor }: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  const t = pct / 100;
  const currentThumbColor = thumbColorFn ? thumbColorFn(pct) : thumbColorEnd ? lerpColor(thumbColor, thumbColorEnd, t) : thumbColor;
  const currentGlow = (thumbColorFn || thumbColorEnd) ? `${currentThumbColor.replace('rgb', 'rgba').replace(')', ', 0.5)')}` : glowColor;

  const update = useCallback((clientX: number) => {
    if (!trackRef.current || disabled) return;
    const rect = trackRef.current.getBoundingClientRect();
    const raw = (clientX - rect.left) / rect.width;
    const clamped = Math.max(0, Math.min(1, raw));
    const stepped = Math.round((clamped * (max - min)) / step) * step + min;
    onChange(Math.max(min, Math.min(max, stepped)));
  }, [min, max, step, onChange, disabled]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (disabled) return;
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    update(e.clientX);
  }, [update, disabled]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (dragging.current) update(e.clientX);
  }, [update]);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  return (
    <div
      ref={trackRef}
      className={`cslider ${disabled ? 'cslider--disabled' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div
        className="cslider-track"
        style={{ background: trackColor || 'rgba(255,255,255,0.1)' }}
      />
      <div
        className="cslider-fill"
        style={{ width: '100%', background: trackColor || currentThumbColor, clipPath: `inset(0 ${100 - pct}% 0 0)` }}
      />
      <div
        className="cslider-thumb"
        style={{
          left: `${pct}%`,
          background: currentThumbColor,
          boxShadow: currentGlow ? `0 0 8px ${currentGlow}` : undefined,
        }}
      />
    </div>
  );
}
