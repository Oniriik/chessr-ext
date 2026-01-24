'use client'

import { useState } from 'react'
import { RotateCw, Square, Play } from 'lucide-react'

export default function DockerControls() {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const executeAction = async (action: 'restart' | 'stop' | 'start') => {
    if (!confirm(`Are you sure you want to ${action} the Docker container?`)) {
      return
    }

    setLoading(true)
    setMessage('')

    try {
      const response = await fetch('/api/docker/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })

      const data = await response.json()

      if (data.error) {
        setMessage(`❌ Error: ${data.error}`)
      } else {
        setMessage(`✅ ${data.message}`)
      }
    } catch (error: any) {
      setMessage(`❌ Error: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Docker Container Control</h3>

      <div className="flex gap-3">
        <button
          onClick={() => executeAction('restart')}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 disabled:opacity-50"
        >
          <RotateCw className="w-4 h-4" />
          Restart
        </button>

        <button
          onClick={() => executeAction('stop')}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
        >
          <Square className="w-4 h-4" />
          Stop
        </button>

        <button
          onClick={() => executeAction('start')}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
        >
          <Play className="w-4 h-4" />
          Start
        </button>
      </div>

      {message && (
        <div className={`p-3 rounded ${message.startsWith('✅') ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
          {message}
        </div>
      )}

      <div className="text-sm text-gray-600">
        <p><strong>Container:</strong> chess-stockfish-server</p>
        <p className="mt-1 text-xs">⚠️ Restarting or stopping the container will disconnect all active users.</p>
      </div>
    </div>
  )
}
