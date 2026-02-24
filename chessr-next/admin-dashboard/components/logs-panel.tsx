'use client'

import { useEffect, useState, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RefreshCw, Download, Loader2 } from 'lucide-react'
import AnsiToHtml from 'ansi-to-html'

const ansiConverter = new AnsiToHtml({
  fg: '#e4e4e7',
  bg: '#0a0a0f',
  colors: {
    0: '#18181b',
    1: '#ef4444',
    2: '#22c55e',
    3: '#eab308',
    4: '#3b82f6',
    5: '#a855f7',
    6: '#06b6d4',
    7: '#e4e4e7',
    8: '#71717a',
    9: '#f87171',
    10: '#4ade80',
    11: '#facc15',
    12: '#60a5fa',
    13: '#c084fc',
    14: '#22d3ee',
    15: '#f4f4f5',
  },
})

export function LogsPanel() {
  const [logs, setLogs] = useState('')
  const [loading, setLoading] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [lineCount, setLineCount] = useState('100')
  const logsEndRef = useRef<HTMLDivElement>(null)

  const fetchLogs = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/logs?lines=${lineCount}`)
      const data = await response.json()
      setLogs(data.logs || '')
    } catch (error) {
      console.error('Failed to fetch logs:', error)
      setLogs('Failed to fetch logs')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchLogs()
  }, [lineCount])

  useEffect(() => {
    if (!autoRefresh) return

    const interval = setInterval(fetchLogs, 5000)
    return () => clearInterval(interval)
  }, [autoRefresh, lineCount])

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs])

  const downloadLogs = () => {
    const blob = new Blob([logs], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `chessr-logs-${new Date().toISOString()}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const renderLogs = () => {
    try {
      return ansiConverter.toHtml(logs)
    } catch {
      return logs
    }
  }

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur">
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <CardTitle className="flex items-center gap-2">
            Docker Logs
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-3">
            {/* Line count selector */}
            <Select value={lineCount} onValueChange={setLineCount}>
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="50">50 lines</SelectItem>
                <SelectItem value="100">100 lines</SelectItem>
                <SelectItem value="200">200 lines</SelectItem>
                <SelectItem value="500">500 lines</SelectItem>
              </SelectContent>
            </Select>

            {/* Auto refresh toggle */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="auto-refresh"
                checked={autoRefresh}
                onCheckedChange={(checked) => setAutoRefresh(checked === true)}
              />
              <label
                htmlFor="auto-refresh"
                className="text-sm text-muted-foreground cursor-pointer"
              >
                Auto refresh
              </label>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={fetchLogs} disabled={loading}>
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
              <Button variant="outline" size="sm" onClick={downloadLogs} disabled={!logs}>
                <Download className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative">
          <div
            className="terminal bg-zinc-950 rounded-lg p-4 h-[500px] overflow-auto border border-border/50"
            dangerouslySetInnerHTML={{ __html: renderLogs() }}
          />
          <div ref={logsEndRef} />
        </div>
      </CardContent>
    </Card>
  )
}
