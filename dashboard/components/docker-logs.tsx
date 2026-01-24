'use client'

import { useState, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'

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

  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">Docker Logs</h2>
        <div className="flex gap-2 items-center">
          <select
            value={lines}
            onChange={(e) => setLines(e.target.value)}
            className="px-2 py-1 border border-gray-300 rounded text-sm"
          >
            <option value="50">Last 50 lines</option>
            <option value="100">Last 100 lines</option>
            <option value="200">Last 200 lines</option>
            <option value="500">Last 500 lines</option>
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            Auto-refresh (5s)
          </label>
          <button
            onClick={fetchLogs}
            disabled={loading}
            className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Logs Display */}
      <div className="flex-1 bg-black text-gray-300 p-4 rounded font-mono text-xs overflow-y-auto min-h-[400px] max-h-[600px]">
        <pre className="whitespace-pre-wrap break-words">{logs}</pre>
      </div>

      <div className="mt-2 text-xs text-gray-500">
        Container: <code className="bg-gray-100 px-1 rounded">chess-stockfish-server</code>
      </div>
    </div>
  )
}
