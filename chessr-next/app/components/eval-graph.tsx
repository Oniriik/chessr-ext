'use client'

import { useRef, useState, useCallback, useEffect } from 'react'

interface EvalPoint {
  ply: number
  eval: number | null  // in pawns, null = no eval (book/start)
  classification?: string
  mateIn?: number | null
  san?: string
}

interface Props {
  points: EvalPoint[]
  currentPly: number
  onSelectPly: (ply: number) => void
  totalPlies: number  // total expected moves (for progressive loading)
  orientation?: 'white' | 'black'
  className?: string
}

const CLS_COLORS: Record<string, string> = {
  brilliant: '#22d3ee',
  great: '#749BBF',
  best: '#34d399',
  excellent: '#6ee7b7',
  good: '#94a3b8',
  book: '#a78bfa',
  inaccuracy: '#fbbf24',
  mistake: '#fb923c',
  miss: '#ef4444',
  blunder: '#f87171',
}

// Clamp eval for display (-8 to +8)
function clampEval(e: number): number {
  return Math.max(-8, Math.min(8, e))
}

export function EvalGraph({ points, currentPly, onSelectPly, totalPlies, orientation, className = '' }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<{ ply: number; eval: number; x: number; y: number } | null>(null)
  const [dimensions, setDimensions] = useState({ width: 600, height: 120 })
  const containerRef = useRef<HTMLDivElement>(null)

  // Resize observer
  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver((entries) => {
      const { width } = entries[0].contentRect
      setDimensions({ width, height: 120 })
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  const { width, height } = dimensions
  const padding = { top: 8, right: 8, bottom: 4, left: 8 }
  const graphW = width - padding.left - padding.right
  const graphH = height - padding.top - padding.bottom
  const maxPly = Math.max(totalPlies, points.length - 1, 1)

  // Scale functions
  const xScale = useCallback((ply: number) => {
    return padding.left + (ply / maxPly) * graphW
  }, [maxPly, graphW, padding.left])

  const yScale = useCallback((evalVal: number) => {
    const clamped = clampEval(evalVal)
    // 0 = middle, -8 = top (bad for white), +8 = bottom area
    // Actually: +eval = good for white = bottom white area
    // We want: white advantage at bottom, black advantage at top
    const normalized = (clamped + 8) / 16  // 0 = -8 (black wins), 1 = +8 (white wins)
    return padding.top + (1 - normalized) * graphH
  }, [graphH, padding.top])

  // Build SVG path
  const pathPoints = points
    .filter(p => p.eval != null)
    .map(p => ({ x: xScale(p.ply), y: yScale(p.eval!) }))

  const linePath = pathPoints.length > 1
    ? `M ${pathPoints.map(p => `${p.x},${p.y}`).join(' L ')}`
    : ''

  const zeroY = yScale(0)

  // White advantage fill: area between the eval line and bottom of graph
  // Clipped at zero line — only shows white area (below zero)
  const bottomY = padding.top + graphH
  const fillWhite = pathPoints.length > 1
    ? `M ${pathPoints[0].x},${bottomY} ${pathPoints.map(p => `L ${p.x},${p.y}`).join(' ')} L ${pathPoints[pathPoints.length - 1].x},${bottomY} Z`
    : ''

  // Mouse handler
  const handleMouse = useCallback((e: React.MouseEvent) => {
    if (!svgRef.current || points.length === 0) return
    const rect = svgRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const ply = Math.round(((x - padding.left) / graphW) * maxPly)
    const clampedPly = Math.max(0, Math.min(ply, points.length - 1))
    const point = points[clampedPly]

    if (point?.eval != null) {
      setHover({
        ply: point.ply,
        eval: point.eval,
        x: xScale(point.ply),
        y: yScale(point.eval),
      })
    }
  }, [points, graphW, maxPly, xScale, yScale, padding.left])

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const ply = Math.round(((x - padding.left) / graphW) * maxPly)
    onSelectPly(Math.max(0, Math.min(ply, points.length)))
  }, [graphW, maxPly, points.length, onSelectPly, padding.left])

  // Classification dots — show all notable moves (not just best/good)
  const dots = points.filter(p => {
    if (!p.classification || p.eval == null) return false
    const isWhiteMove = p.ply % 2 === 1
    const isPlayerMove = orientation ? (orientation === 'white' ? isWhiteMove : !isWhiteMove) : true
    // Show "best" only for player captures
    if (p.classification === 'best') return isPlayerMove && !!p.san?.includes('x')
    if (['good', 'excellent'].includes(p.classification!)) return false
    // Hide opponent's book moves
    if (p.classification === 'book' && !isPlayerMove) return false
    return true
  })

  return (
    <div ref={containerRef} className={`relative select-none ${className}`}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="cursor-crosshair"
        onMouseMove={handleMouse}
        onMouseLeave={() => setHover(null)}
        onClick={handleClick}
      >
        {/* No background — transparent */}

        {/* Zero line */}
        <line x1={padding.left} y1={zeroY} x2={width - padding.right} y2={zeroY} stroke="#333" strokeWidth={1} />

        {/* Clip path for white area (below zero line only) */}
        <defs>
          <clipPath id={`clip-white-${width}`}>
            <rect x={padding.left} y={zeroY} width={graphW} height={bottomY - zeroY} />
          </clipPath>
        </defs>

        {/* White advantage fill */}
        {fillWhite && <path d={fillWhite} fill="rgba(255,255,255,0.18)" clipPath={`url(#clip-white-${width})`} />}

        {/* Eval line */}
        {linePath && <path d={linePath} fill="none" stroke="#888" strokeWidth={1.5} />}

        {/* Classification dots */}
        {dots.map((p) => (
          <circle
            key={p.ply}
            cx={xScale(p.ply)}
            cy={yScale(p.eval!)}
            r={3.5}
            fill={CLS_COLORS[p.classification!] || '#888'}
            stroke="#0d0d1a"
            strokeWidth={1}
          />
        ))}

        {/* Current position indicator */}
        {currentPly > 0 && currentPly <= points.length && (
          <line
            x1={xScale(currentPly)}
            y1={padding.top}
            x2={xScale(currentPly)}
            y2={height - padding.bottom}
            stroke="#3b82f6"
            strokeWidth={1.5}
            opacity={0.8}
          />
        )}

        {/* Hover line */}
        {hover && (
          <>
            <line
              x1={hover.x}
              y1={padding.top}
              x2={hover.x}
              y2={height - padding.bottom}
              stroke="#666"
              strokeWidth={1}
              strokeDasharray="3,3"
            />
            <circle cx={hover.x} cy={hover.y} r={4} fill="#fff" stroke="#3b82f6" strokeWidth={2} />
          </>
        )}
      </svg>

      {/* Hover tooltip */}
      {hover && (
        <div
          className="absolute pointer-events-none bg-background/90 border border-border rounded px-2 py-1 text-xs font-mono backdrop-blur-sm"
          style={{
            left: Math.min(hover.x, width - 80),
            top: -28,
          }}
        >
          <span className={hover.eval >= 0 ? 'text-white' : 'text-zinc-400'}>
            {hover.eval >= 0 ? '+' : ''}{hover.eval.toFixed(1)}
          </span>
          <span className="text-muted-foreground ml-1.5">move {Math.ceil(hover.ply / 2)}</span>
        </div>
      )}
    </div>
  )
}
