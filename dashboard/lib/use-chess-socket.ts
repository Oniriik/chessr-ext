'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

interface AnalysisResult {
  type: 'analyze_result'
  requestId: string
  payload: any
  meta: {
    timings: {
      reviewMs: number
      suggestionMs: number
      totalMs: number
    }
  }
}

interface AnalysisError {
  type: 'analyze_error'
  requestId: string
  error: {
    code: string
    message: string
  }
}

type MessageCallback = (message: AnalysisResult | AnalysisError) => void

export function useChessSocket(serverUrl: string) {
  const [isConnected, setIsConnected] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const messageCallbacks = useRef<Map<string, MessageCallback>>(new Map())
  const reconnectAttempts = useRef(0)
  const maxReconnectAttempts = 10

  const connect = useCallback(async () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return
    }

    try {
      const ws = new WebSocket(serverUrl)
      wsRef.current = ws

      ws.onopen = () => {
        console.log('[Chess Socket] Connected')
        setIsConnected(true)
        reconnectAttempts.current = 0
      }

      ws.onmessage = async (event) => {
        try {
          const message = JSON.parse(event.data)
          console.log('[Chess Socket] Message:', message.type)

          if (message.type === 'ready') {
            // Send auth on ready
            console.log('[Chess Socket] Ready message received, getting session...')
            const { data: { session }, error } = await supabase.auth.getSession()

            console.log('[Chess Socket] Session:', session ? 'found' : 'not found', error ? `error: ${error}` : '')

            if (session) {
              console.log('[Chess Socket] Sending auth with token')
              ws.send(JSON.stringify({
                type: 'auth',
                token: session.access_token,
                version: '1.3.0',
              }))
            } else {
              console.error('[Chess Socket] No session found, cannot authenticate')
            }
          } else if (message.type === 'auth_success') {
            console.log('[Chess Socket] Authenticated')
            setIsAuthenticated(true)
          } else if (message.type === 'auth_failed') {
            console.error('[Chess Socket] Auth failed')
            setIsAuthenticated(false)
          } else if (message.type === 'analyze_result' || message.type === 'analyze_error') {
            // Call the callback for this requestId
            const callback = messageCallbacks.current.get(message.requestId)
            if (callback) {
              callback(message)
              messageCallbacks.current.delete(message.requestId)
            }
          }
        } catch (err) {
          console.error('[Chess Socket] Failed to parse message:', err)
        }
      }

      ws.onclose = (event) => {
        console.log('[Chess Socket] Disconnected', event.code)
        setIsConnected(false)
        setIsAuthenticated(false)
        wsRef.current = null

        // Don't reconnect on auth errors
        if (event.code === 4001 || event.code === 4002) {
          return
        }

        // Schedule reconnect
        if (reconnectAttempts.current < maxReconnectAttempts) {
          reconnectAttempts.current++
          const delay = 1000 * Math.pow(2, reconnectAttempts.current - 1)
          setTimeout(connect, delay)
        }
      }

      ws.onerror = (event) => {
        console.error('[Chess Socket] Error:', event)
      }
    } catch (err) {
      console.error('[Chess Socket] Connection failed:', err)
    }
  }, [serverUrl])

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setIsConnected(false)
    setIsAuthenticated(false)
  }, [])

  const sendAnalysis = useCallback((
    requestId: string,
    movesUci: string[] = [],
    settings = {
      targetElo: 2000,
      personality: 'balanced' as const,
      multiPV: 3,
    }
  ): Promise<AnalysisResult | AnalysisError> => {
    return new Promise((resolve, reject) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'))
        return
      }

      if (!isAuthenticated) {
        reject(new Error('Not authenticated'))
        return
      }

      // Set up callback for this request
      const timeout = setTimeout(() => {
        messageCallbacks.current.delete(requestId)
        reject(new Error('Request timeout'))
      }, 30000)

      messageCallbacks.current.set(requestId, (message) => {
        clearTimeout(timeout)
        resolve(message)
      })

      // Send analysis request (same format as extension)
      wsRef.current.send(JSON.stringify({
        type: 'analyze',
        requestId,
        payload: {
          movesUci,
          review: {
            lastMoves: 1,
            cachedAccuracy: [],
          },
          user: settings,
        },
      }))
    })
  }, [isAuthenticated])

  // Connect on mount
  useEffect(() => {
    connect()
    return () => {
      disconnect()
    }
  }, [connect, disconnect])

  return {
    isConnected,
    isAuthenticated,
    sendAnalysis,
    reconnect: connect,
  }
}
