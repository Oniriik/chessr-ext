import type { ReactNode } from 'react';

// Minimal ANSI SGR → React span converter. Covers the codes the serveur emits.
const COLOR: Record<number, string> = {
  30: '#94a3b8',
  31: '#f87171', // red
  32: '#4ade80', // green
  33: '#facc15', // yellow
  34: '#60a5fa', // blue
  35: '#f472b6', // magenta
  36: '#22d3ee', // cyan
  37: '#e2e8f0', // white
  90: '#94a3b8', // bright black / gray
  91: '#fca5a5',
  92: '#86efac',
  93: '#fde68a',
  94: '#93c5fd',
  95: '#f9a8d4', // bright magenta
  96: '#67e8f9', // bright cyan
  97: '#f8fafc',
};

export function ansiToReact(line: string): ReactNode {
  if (!line.includes('\x1b[')) return line;

  const parts: ReactNode[] = [];
  const re = /\x1b\[([0-9;]*)m/g;
  let lastIndex = 0;
  let current: { color?: string; bold?: boolean } = {};
  let key = 0;

  const push = (text: string) => {
    if (!text) return;
    if (!current.color && !current.bold) {
      parts.push(text);
    } else {
      parts.push(
        <span key={key++} style={{ color: current.color, fontWeight: current.bold ? 700 : undefined }}>
          {text}
        </span>,
      );
    }
  };

  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) {
    push(line.slice(lastIndex, match.index));
    lastIndex = re.lastIndex;
    const codes = match[1].split(';').filter(Boolean).map(Number);
    if (codes.length === 0 || codes.includes(0)) {
      current = {};
      continue;
    }
    for (const code of codes) {
      if (code === 1) current.bold = true;
      else if (code === 22) current.bold = false;
      else if (COLOR[code]) current.color = COLOR[code];
      else if (code === 39) current.color = undefined;
    }
  }
  push(line.slice(lastIndex));
  return parts;
}
