'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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
        <Button onClick={clearOutput} variant="outline" size="sm">
          Clear
        </Button>
      </div>

      {/* Terminal Output */}
      <div className="flex-1 bg-zinc-950 text-green-400 p-4 rounded-lg font-mono text-sm overflow-y-auto mb-4 min-h-[400px] max-h-[600px] border border-border">
        {output.length === 0 ? (
          <div className="text-muted-foreground">Terminal ready. Enter a command below.</div>
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
        <Input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter command (e.g., ls -la, docker ps)"
          disabled={loading}
          className="flex-1 font-mono"
        />
        <Button
          onClick={executeCommand}
          disabled={loading || !command.trim()}
        >
          {loading ? 'Running...' : 'Execute'}
        </Button>
      </div>

      <div className="mt-2 text-xs text-muted-foreground">
        Common commands:{' '}
        <code className="bg-muted px-1.5 py-0.5 rounded">docker ps</code>,{' '}
        <code className="bg-muted px-1.5 py-0.5 rounded">docker logs chess-stockfish-server</code>,{' '}
        <code className="bg-muted px-1.5 py-0.5 rounded">ls -la</code>
      </div>
    </div>
  )
}
