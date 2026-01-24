'use client'

import { useState } from 'react'

export default function SSHTerminal() {
  const [command, setCommand] = useState('')
  const [output, setOutput] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  const executeCommand = async () => {
    if (!command.trim()) return

    setLoading(true)
    setOutput(prev => [...prev, `$ ${command}`])

    try {
      const response = await fetch('/api/ssh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      })

      const data = await response.json()

      if (data.error) {
        setOutput(prev => [...prev, `Error: ${data.error}`])
      } else {
        setOutput(prev => [...prev, data.output || '(no output)'])
      }
    } catch (error: any) {
      setOutput(prev => [...prev, `Error: ${error.message}`])
    } finally {
      setLoading(false)
      setCommand('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      executeCommand()
    }
  }

  const clearOutput = () => {
    setOutput([])
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">SSH Terminal</h2>
        <button
          onClick={clearOutput}
          className="px-3 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 text-sm"
        >
          Clear
        </button>
      </div>

      {/* Terminal Output */}
      <div className="flex-1 bg-black text-green-400 p-4 rounded font-mono text-sm overflow-y-auto mb-4 min-h-[400px] max-h-[600px]">
        {output.length === 0 ? (
          <div className="text-gray-500">Terminal ready. Enter a command below.</div>
        ) : (
          output.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-words">
              {line}
            </div>
          ))
        )}
      </div>

      {/* Command Input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter command (e.g., ls -la, docker ps)"
          disabled={loading}
          className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
        />
        <button
          onClick={executeCommand}
          disabled={loading || !command.trim()}
          className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Running...' : 'Execute'}
        </button>
      </div>

      <div className="mt-2 text-xs text-gray-500">
        Common commands: <code className="bg-gray-100 px-1 rounded">docker ps</code>,{' '}
        <code className="bg-gray-100 px-1 rounded">docker logs chess-stockfish-server</code>,{' '}
        <code className="bg-gray-100 px-1 rounded">ls -la</code>
      </div>
    </div>
  )
}
