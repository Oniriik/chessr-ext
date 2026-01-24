'use client'

import { useState, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// ANSI color code to CSS class mapping
const ansiToClass: Record<string, string> = {
  '0': '', // reset
  '1': 'font-bold',
  '2': 'opacity-60',
  '30': 'text-zinc-900',
  '31': 'text-red-400',
  '32': 'text-green-400',
  '33': 'text-yellow-400',
  '34': 'text-blue-400',
  '35': 'text-purple-400',
  '36': 'text-cyan-400',
  '37': 'text-white',
  '90': 'text-zinc-500',
}

function parseAnsiToHtml(text: string): string {
  // Match ANSI escape sequences
  const ansiRegex = /\x1b\[([0-9;]+)m/g

  let result = ''
  let lastIndex = 0
  let currentClasses: string[] = []
  let match

  while ((match = ansiRegex.exec(text)) !== null) {
    // Add text before this match
    if (match.index > lastIndex) {
      const content = text.slice(lastIndex, match.index)
      if (currentClasses.length > 0) {
        result += `<span class="${currentClasses.join(' ')}">${escapeHtml(content)}</span>`
      } else {
        result += escapeHtml(content)
      }
    }

    // Parse the ANSI codes
    const codes = match[1].split(';')
    for (const code of codes) {
      if (code === '0') {
        currentClasses = []
      } else if (ansiToClass[code]) {
        currentClasses.push(ansiToClass[code])
      }
    }

    lastIndex = match.index + match[0].length
  }

  // Add remaining text
  if (lastIndex < text.length) {
    const content = text.slice(lastIndex)
    if (currentClasses.length > 0) {
      result += `<span class="${currentClasses.join(' ')}">${escapeHtml(content)}</span>`
    } else {
      result += escapeHtml(content)
    }
  }

  return result
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export default function DockerLogs() {
  const [logs, setLogs] = useState('')
  const [loading, setLoading] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [lines, setLines] = useState('100')

  const fetchLogs = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/docker/logs?lines=${lines}`)
      const data = await response.json()

      if (data.error) {
        setLogs(`Error: ${data.error}`)
      } else {
        setLogs(data.logs || '(no logs)')
      }
    } catch (error: any) {
      setLogs(`Error: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchLogs()
  }, [])

  useEffect(() => {
    if (autoRefresh) {
      const interval = setInterval(fetchLogs, 5000)
      return () => clearInterval(interval)
    }
  }, [autoRefresh, lines])

  const formattedLogs = parseAnsiToHtml(logs)

  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">Docker Logs</h2>
        <div className="flex gap-3 items-center">
          <Select value={lines} onValueChange={setLines}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="50">Last 50 lines</SelectItem>
              <SelectItem value="100">Last 100 lines</SelectItem>
              <SelectItem value="200">Last 200 lines</SelectItem>
              <SelectItem value="500">Last 500 lines</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="auto-refresh"
              checked={autoRefresh}
              onCheckedChange={(checked) => setAutoRefresh(checked as boolean)}
            />
            <label htmlFor="auto-refresh" className="text-sm cursor-pointer">
              Auto-refresh (5s)
            </label>
          </div>

          <Button onClick={fetchLogs} disabled={loading} size="sm">
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Logs Display */}
      <div className="flex-1 bg-zinc-950 text-zinc-300 p-4 rounded-lg font-mono text-xs overflow-y-auto min-h-[400px] max-h-[600px] border border-border">
        <pre
          className="whitespace-pre-wrap break-words"
          dangerouslySetInnerHTML={{ __html: formattedLogs }}
        />
      </div>

      <div className="mt-2 text-xs text-muted-foreground">
        Container: <code className="bg-muted px-1.5 py-0.5 rounded">chess-stockfish-server</code>
      </div>
    </div>
  )
}
