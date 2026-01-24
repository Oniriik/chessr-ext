'use client'

import { useState } from 'react'
import { RotateCw, Square, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

export default function DockerControls() {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)

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
        setIsError(true)
        setMessage(data.error)
      } else {
        setIsError(false)
        setMessage(data.message)
      }
    } catch (error: any) {
      setIsError(true)
      setMessage(error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Docker Container Control</CardTitle>
        <CardDescription>
          Container: <code className="bg-muted px-1.5 py-0.5 rounded text-sm">chess-stockfish-server</code>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-3">
          <Button
            onClick={() => executeAction('restart')}
            disabled={loading}
            variant="outline"
            className="border-yellow-600 text-yellow-600 hover:bg-yellow-600 hover:text-white"
          >
            <RotateCw className="w-4 h-4 mr-2" />
            Restart
          </Button>

          <Button
            onClick={() => executeAction('stop')}
            disabled={loading}
            variant="destructive"
          >
            <Square className="w-4 h-4 mr-2" />
            Stop
          </Button>

          <Button
            onClick={() => executeAction('start')}
            disabled={loading}
            className="bg-green-600 hover:bg-green-700"
          >
            <Play className="w-4 h-4 mr-2" />
            Start
          </Button>
        </div>

        {message && (
          <Alert variant={isError ? 'destructive' : 'default'}>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        )}

        <p className="text-xs text-muted-foreground">
          Restarting or stopping the container will disconnect all active users.
        </p>
      </CardContent>
    </Card>
  )
}
