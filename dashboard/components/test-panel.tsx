'use client'

import { useState } from 'react'
import { Play, CheckCircle, XCircle } from 'lucide-react'

const DEFAULT_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export default function TestPanel() {
  const [fen, setFen] = useState(DEFAULT_FEN)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')
  const [responseTime, setResponseTime] = useState<number | null>(null)

  const runTest = async () => {
    setLoading(true)
    setResult(null)
    setError('')
    setResponseTime(null)

    const startTime = Date.now()

    try {
      const response = await fetch('/api/test-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen }),
      })

      const endTime = Date.now()
      setResponseTime(endTime - startTime)

      const data = await response.json()

      if (data.error) {
        setError(data.error)
      } else {
        setResult(data.result)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const loadExample = (exampleFen: string, description: string) => {
    setFen(exampleFen)
    setResult(null)
    setError('')
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Analysis Test</h2>

      {/* FEN Input */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          FEN Position
        </label>
        <input
          type="text"
          value={fen}
          onChange={(e) => setFen(e.target.value)}
          placeholder="Enter FEN position"
          className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="mt-2 flex gap-2 flex-wrap">
          <button
            onClick={() => loadExample(DEFAULT_FEN, 'Starting position')}
            className="text-xs px-2 py-1 bg-gray-100 rounded hover:bg-gray-200"
          >
            Starting Position
          </button>
          <button
            onClick={() => loadExample('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', 'After 1.e4 e5 2.Nf3 Nc6')}
            className="text-xs px-2 py-1 bg-gray-100 rounded hover:bg-gray-200"
          >
            Italian Opening
          </button>
        </div>
      </div>

      {/* Test Button */}
      <button
        onClick={runTest}
        disabled={loading || !fen}
        className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Play className="w-5 h-5" />
        {loading ? 'Analyzing...' : 'Run Analysis Test'}
      </button>

      {/* Response Time */}
      {responseTime !== null && (
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle className="w-4 h-4 text-green-600" />
          <span>Response time: <strong>{responseTime}ms</strong></span>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded flex items-start gap-2">
          <XCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <strong>Error:</strong> {error}
          </div>
        </div>
      )}

      {/* Result Display */}
      {result && (
        <div className="bg-white border rounded-lg p-4 space-y-3">
          <h3 className="font-semibold text-lg">Analysis Result</h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-sm text-gray-600">Best Move:</span>
              <p className="text-lg font-bold">{result.bestMove}</p>
            </div>
            <div>
              <span className="text-sm text-gray-600">Evaluation:</span>
              <p className="text-lg font-bold">
                {result.mate
                  ? `M${result.mate}`
                  : (result.evaluation / 100).toFixed(2)
                }
              </p>
            </div>
            <div>
              <span className="text-sm text-gray-600">Depth:</span>
              <p className="text-lg font-bold">{result.depth}</p>
            </div>
            {result.ponder && (
              <div>
                <span className="text-sm text-gray-600">Ponder:</span>
                <p className="text-lg font-bold">{result.ponder}</p>
              </div>
            )}
          </div>

          {/* Lines */}
          {result.lines && result.lines.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold mb-2">Top Lines:</h4>
              <div className="space-y-2">
                {result.lines.map((line: any, idx: number) => (
                  <div key={idx} className="bg-gray-50 p-2 rounded text-sm">
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-semibold">Line {idx + 1}</span>
                      <span className="text-gray-600">
                        {line.mate ? `M${line.mate}` : (line.evaluation / 100).toFixed(2)}
                      </span>
                    </div>
                    <code className="text-xs text-gray-700">
                      {line.moves.slice(0, 6).join(' ')}
                      {line.moves.length > 6 && '...'}
                    </code>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Server Info */}
      <div className="text-xs text-gray-500 bg-gray-50 p-3 rounded">
        <p><strong>Server:</strong> {process.env.NEXT_PUBLIC_CHESS_SERVER_URL || 'wss://ws.chessr.io'}</p>
        <p><strong>Settings:</strong> Depth 15, ELO 2000, Balanced mode, MultiPV 3</p>
      </div>
    </div>
  )
}
