'use client'

import { useState } from 'react'
import { Play, CheckCircle, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'

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

  const loadExample = (exampleFen: string) => {
    setFen(exampleFen)
    setResult(null)
    setError('')
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Analysis Test</h2>

      {/* FEN Input */}
      <div className="space-y-2">
        <label className="text-sm font-medium">FEN Position</label>
        <Input
          type="text"
          value={fen}
          onChange={(e) => setFen(e.target.value)}
          placeholder="Enter FEN position"
          className="font-mono"
        />
        <div className="flex gap-2 flex-wrap">
          <Button
            onClick={() => loadExample(DEFAULT_FEN)}
            variant="secondary"
            size="sm"
          >
            Starting Position
          </Button>
          <Button
            onClick={() => loadExample('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3')}
            variant="secondary"
            size="sm"
          >
            Italian Opening
          </Button>
        </div>
      </div>

      {/* Test Button */}
      <Button onClick={runTest} disabled={loading || !fen} size="lg">
        <Play className="w-5 h-5 mr-2" />
        {loading ? 'Analyzing...' : 'Run Analysis Test'}
      </Button>

      {/* Response Time */}
      {responseTime !== null && (
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle className="w-4 h-4 text-green-500" />
          <span>Response time: <strong>{responseTime}ms</strong></span>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <Alert variant="destructive">
          <XCircle className="w-4 h-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Result Display */}
      {result && (
        <Card>
          <CardHeader>
            <CardTitle>Analysis Result</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-sm text-muted-foreground">Best Move</span>
                <p className="text-xl font-bold font-mono">{result.bestMove}</p>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">Evaluation</span>
                <p className="text-xl font-bold">
                  {result.mate
                    ? `M${result.mate}`
                    : (result.evaluation / 100).toFixed(2)
                  }
                </p>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">Depth</span>
                <p className="text-xl font-bold">{result.depth}</p>
              </div>
              {result.ponder && (
                <div>
                  <span className="text-sm text-muted-foreground">Ponder</span>
                  <p className="text-xl font-bold font-mono">{result.ponder}</p>
                </div>
              )}
            </div>

            {/* Lines */}
            {result.lines && result.lines.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-2">Top Lines</h4>
                <div className="space-y-2">
                  {result.lines.map((line: any, idx: number) => (
                    <div key={idx} className="bg-muted p-3 rounded-lg">
                      <div className="flex justify-between items-center mb-1">
                        <Badge variant="outline">Line {idx + 1}</Badge>
                        <span className="text-sm text-muted-foreground">
                          {line.mate ? `M${line.mate}` : (line.evaluation / 100).toFixed(2)}
                        </span>
                      </div>
                      <code className="text-xs text-muted-foreground font-mono">
                        {line.moves.slice(0, 6).join(' ')}
                        {line.moves.length > 6 && '...'}
                      </code>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Server Info */}
      <Card>
        <CardContent className="pt-4">
          <div className="text-xs text-muted-foreground space-y-1">
            <p><strong>Server:</strong> {process.env.NEXT_PUBLIC_CHESS_SERVER_URL || 'wss://ws.chessr.io'}</p>
            <p><strong>Settings:</strong> Depth 15, ELO 2000, Balanced mode, MultiPV 3</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
