import type { CSSProperties } from 'react';

// Shared micro-primitives for floating widgets and other compact UIs.
// Matches the design system (docs/design-system/system.md):
// — rgba(255,255,255,0.03) card background
// — tiny uppercase labels at 7-8px with 0.04em letter-spacing
// — rgba(255,255,255,0.08) borders for interactive idle

export const fCard: CSSProperties = {
  background: 'rgba(255, 255, 255, 0.03)',
  borderRadius: 8,
  padding: '8px 10px',
};

export const fRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
};

export const fLabel: CSSProperties = {
  fontSize: 7,
  color: 'rgba(255, 255, 255, 0.25)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

export const fSelect: CSSProperties = {
  padding: '3px 20px 3px 8px',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  borderRadius: 5,
  background: 'rgba(255, 255, 255, 0.03)',
  color: '#e4e4e7',
  fontSize: 10,
  fontWeight: 600,
  cursor: 'pointer',
  appearance: 'none',
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='m1.5 3 2.5 2.5 2.5-2.5'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 6px center',
  outline: 'none',
};

export const fToggle: CSSProperties = {
  width: 24,
  height: 14,
  borderRadius: 7,
  border: 'none',
  cursor: 'pointer',
  position: 'relative',
  transition: 'background 0.15s',
};

export const fKnob: CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: '50%',
  background: '#e4e4e7',
  position: 'absolute',
  top: 2,
  transition: 'left 0.15s',
};

export const fAutoBtn = (active: boolean): CSSProperties => ({
  fontSize: 7,
  fontWeight: 600,
  padding: '2px 7px',
  borderRadius: 3,
  border: `1px solid ${active ? '#3b82f6' : 'rgba(255, 255, 255, 0.08)'}`,
  background: active ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
  color: active ? '#3b82f6' : 'rgba(255, 255, 255, 0.25)',
  cursor: 'pointer',
});
