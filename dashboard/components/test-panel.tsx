'use client'

import { useState } from 'react'
import { Zap, CheckCircle, XCircle, Wifi, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { useChessSocket } from '@/lib/use-chess-socket'

// Sample mid-game position (Italian Game, about 15 moves in)
const TEST_MOVES = [
  'e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5',
  'd2d3', 'g8f6', 'c2c3', 'd7d6', 'b1d2', 'a7a6',
  'c4b3', 'c8e6', 'd2c4', 'e6b3', 'a2b3', 'e8g8',
  'h2h3', 'd8e7', 'e1g1', 'f8e8', 'f1e1', 'a8d8',
  'c4e3', 'h7h6', 'd1c2', 'c6e5', 'f3e5', 'd6e5',
]

export default function TestPanel() {
  const serverUrl = process.env.NEXT_PUBLIC_CHESS_SERVER_URL || 'ws://localhost:3001'
  const { isConnected, isAuthenticated, sendAnalysis } = useChessSocket(serverUrl)

  const [requestCount, setRequestCount] = useState([10])
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<{
    success: number
    failed: number
    duration: number
    avgResponseTime: number
  } | null>(null)

  const runLoadTest = async () => {
    if (!isAuthenticated) {
      console.error('Not authenticated')
      return
    }

    setLoading(true)
    setResults(null)
    const startTime = Date.now()
    const responseTimes: number[] = []

    try {
      // Send N concurrent requests using WebSocket
      const promises = Array.from({ length: requestCount[0] }, (_, i) => {
        const requestStart = Date.now()
        const requestId = `test-${Date.now()}-${i}`

        return sendAnalysis(requestId, TEST_MOVES)
          .then((result) => {
            const requestDuration = Date.now() - requestStart
            responseTimes.push(requestDuration)
            return { success: result.type === 'analyze_result' }
          })
          .catch(() => ({ success: false }))
      })

      const responses = await Promise.all(promises)
      const duration = Date.now() - startTime

      const success = responses.filter(r => r.success).length
      const failed = responses.length - success
      const avgResponseTime = responseTimes.length > 0
        ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
        : 0

      setResults({ success, failed, duration, avgResponseTime })
    } catch (error) {
      console.error('Load test error:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Load Testing</h2>
        <div className="flex items-center gap-2 text-sm">
          {isConnected ? (
            <>
              <Wifi className="w-4 h-4 text-green-600" />
              <span className="text-green-600">
                {isAuthenticated ? 'Connected' : 'Authenticating...'}
              </span>
            </>
          ) : (
            <>
              <WifiOff className="w-4 h-4 text-red-600" />
              <span className="text-red-600">Disconnected</span>
            </>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5" />
            Concurrent Requests
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Slider */}
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <label className="text-sm font-medium">Number of requests:</label>
              <span className="text-2xl font-bold text-primary">{requestCount[0]}</span>
            </div>
            <Slider
              value={requestCount}
              onValueChange={setRequestCount}
              min={1}
              max={100}
              step={1}
              className="w-full"
              disabled={loading || !isAuthenticated}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>1</span>
              <span>25</span>
              <span>50</span>
              <span>75</span>
              <span>100</span>
            </div>
          </div>

          {/* Test Button */}
          <Button
            onClick={runLoadTest}
            disabled={loading || !isAuthenticated}
            size="lg"
            className="w-full"
          >
            <Zap className="w-5 h-5 mr-2" />
            {loading ? 'Running...' : !isAuthenticated ? 'Not Connected' : `Send ${requestCount[0]} Request${requestCount[0] > 1 ? 's' : ''}`}
          </Button>

          {/* Results */}
          {results && (
            <div className="space-y-3 pt-4 border-t">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Success:</span>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <span className="text-lg font-semibold text-green-600">{results.success}</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Failed:</span>
                <div className="flex items-center gap-2">
                  <XCircle className="w-4 h-4 text-red-600" />
                  <span className="text-lg font-semibold text-red-600">{results.failed}</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Total Duration:</span>
                <span className="text-lg font-semibold">{results.duration}ms</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Avg Response:</span>
                <span className="text-lg font-semibold">{results.avgResponseTime}ms</span>
              </div>
              <div className="flex items-center justify-between pt-2 border-t">
                <span className="text-sm text-muted-foreground">Success Rate:</span>
                <span className="text-lg font-semibold">
                  {((results.success / (results.success + results.failed)) * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Server Info */}
      <Card>
        <CardContent className="pt-4">
          <div className="text-xs text-muted-foreground space-y-1">
            <p><strong>Server:</strong> {process.env.NEXT_PUBLIC_CHESS_SERVER_URL || 'ws://localhost:3001'}</p>
            <p><strong>Position:</strong> Starting position</p>
            <p><strong>Settings:</strong> Depth 15, ELO 2000, Balanced mode, MultiPV 3</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
