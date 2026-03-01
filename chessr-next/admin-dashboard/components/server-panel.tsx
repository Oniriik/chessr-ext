'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Server,
  Play,
  Square,
  RotateCcw,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  Terminal,
  Download,
  Package,
  Wrench,
} from 'lucide-react'

interface ServiceStatus {
  ID: string
  Name: string
  Service: string
  State: string
  Status: string
  Health?: string
}

interface ServerState {
  services: ServiceStatus[]
  serverHost: string
}

type ActionType = 'start' | 'stop' | 'restart' | 'update'

export function ServerPanel() {
  const [state, setState] = useState<ServerState | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [logs, setLogs] = useState<string | null>(null)
  const [logsService, setLogsService] = useState<string | null>(null)
  const [updateOutput, setUpdateOutput] = useState<string | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean
    action: ActionType
    service: string | null
    title: string
  } | null>(null)

  // Maintenance scheduling
  const [maintenanceStart, setMaintenanceStart] = useState('')
  const [maintenanceEnd, setMaintenanceEnd] = useState('')
  const [currentMaintenance, setCurrentMaintenance] = useState<{
    scheduled: boolean; startTimestamp: number; endTimestamp: number
  } | null>(null)
  const [maintenanceLoading, setMaintenanceLoading] = useState(false)

  const fetchMaintenance = async () => {
    try {
      const res = await fetch('/api/maintenance')
      if (res.ok) setCurrentMaintenance(await res.json())
    } catch {}
  }

  const scheduleMaintenance = async () => {
    if (!maintenanceStart || !maintenanceEnd) return
    setMaintenanceLoading(true)
    try {
      const startTimestamp = Math.floor(new Date(maintenanceStart).getTime() / 1000)
      const endTimestamp = Math.floor(new Date(maintenanceEnd).getTime() / 1000)
      const res = await fetch('/api/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startTimestamp, endTimestamp }),
      })
      if (res.ok) {
        setMaintenanceStart('')
        setMaintenanceEnd('')
        await fetchMaintenance()
      }
    } catch {} finally {
      setMaintenanceLoading(false)
    }
  }

  const cancelMaintenance = async () => {
    setMaintenanceLoading(true)
    try {
      const res = await fetch('/api/maintenance', { method: 'DELETE' })
      if (res.ok) await fetchMaintenance()
    } catch {} finally {
      setMaintenanceLoading(false)
    }
  }

  const fetchStatus = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/server')
      if (response.ok) {
        const data = await response.json()
        setState(data)
      }
    } catch (error) {
      console.error('Failed to fetch server status:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStatus()
    fetchMaintenance()
    const interval = setInterval(fetchStatus, 15000)
    return () => clearInterval(interval)
  }, [])

  const executeAction = async (action: ActionType, service: string | null) => {
    setConfirmDialog(null)
    setActionLoading(service || 'all')

    try {
      const response = await fetch('/api/server', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, service }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Action failed')
      }

      // Show output for update actions
      if (action === 'update' && data.output) {
        setUpdateOutput(data.output)
      }

      // Wait a bit for the action to take effect
      await new Promise((resolve) => setTimeout(resolve, 2000))
      await fetchStatus()
    } catch (error) {
      console.error('Action failed:', error)
      toast.error(`Action failed: ${error}`)
    } finally {
      setActionLoading(null)
    }
  }

  const updateExtension = async () => {
    setActionLoading('extension')
    setUpdateOutput('Building extension package...')

    try {
      const response = await fetch('/api/server', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update-extension' }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to build extension')
      }

      setUpdateOutput(data.output || 'Extension built successfully')
    } catch (error) {
      console.error('Extension build failed:', error)
      setUpdateOutput(`Failed: ${error}`)
    } finally {
      setActionLoading(null)
    }
  }

  const fetchLogs = async (service: string) => {
    setLogsService(service)
    setLogs('Loading...')

    try {
      const response = await fetch('/api/server', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'logs', service }),
      })

      const data = await response.json()
      setLogs(data.output || data.error || 'No logs available')
    } catch (error) {
      setLogs(`Failed to fetch logs: ${error}`)
    }
  }

  const openConfirmDialog = (action: ActionType, service: string | null) => {
    const serviceName = service || 'all services'
    const titles: Record<ActionType, string> = {
      start: `Start ${serviceName}?`,
      stop: `Stop ${serviceName}?`,
      restart: `Restart ${serviceName}?`,
      update: `Update ${serviceName}?`,
    }
    setConfirmDialog({
      open: true,
      action,
      service,
      title: titles[action],
    })
  }

  const getStatusIcon = (status: ServiceStatus) => {
    const state = status.State?.toLowerCase()
    const health = status.Health?.toLowerCase()

    if (state === 'running' && health === 'healthy') {
      return <CheckCircle2 className="w-5 h-5 text-emerald-500" />
    }
    if (state === 'running') {
      return <AlertCircle className="w-5 h-5 text-amber-500" />
    }
    if (state === 'exited' || state === 'dead') {
      return <XCircle className="w-5 h-5 text-red-500" />
    }
    return <AlertCircle className="w-5 h-5 text-muted-foreground" />
  }

  const getStatusBadge = (status: ServiceStatus) => {
    const state = status.State?.toLowerCase()
    const health = status.Health?.toLowerCase()

    let bgColor = 'bg-muted'
    let textColor = 'text-muted-foreground'

    if (state === 'running' && health === 'healthy') {
      bgColor = 'bg-emerald-500/10'
      textColor = 'text-emerald-500'
    } else if (state === 'running') {
      bgColor = 'bg-amber-500/10'
      textColor = 'text-amber-500'
    } else if (state === 'exited' || state === 'dead') {
      bgColor = 'bg-red-500/10'
      textColor = 'text-red-500'
    }

    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${bgColor} ${textColor}`}>
        {status.Status || status.State || 'Unknown'}
      </span>
    )
  }

  return (
    <div className="space-y-6">
      {/* Maintenance scheduling */}
      <Card className="border-border/50 bg-card/50 backdrop-blur">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wrench className="w-5 h-5 text-orange-400" />
            Scheduled Maintenance
          </CardTitle>
        </CardHeader>
        <CardContent>
          {currentMaintenance?.scheduled ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">
                  {new Date(currentMaintenance.startTimestamp * 1000).toLocaleString()}
                  {' → '}
                  {new Date(currentMaintenance.endTimestamp * 1000).toLocaleString()}
                </p>
              </div>
              <Button variant="destructive" size="sm" onClick={cancelMaintenance} disabled={maintenanceLoading}>
                {maintenanceLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Cancel'}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">Start</label>
                <Input
                  type="datetime-local"
                  value={maintenanceStart}
                  onChange={(e) => setMaintenanceStart(e.target.value)}
                  className="w-auto"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">End</label>
                <Input
                  type="datetime-local"
                  value={maintenanceEnd}
                  onChange={(e) => setMaintenanceEnd(e.target.value)}
                  className="w-auto"
                />
              </div>
              <Button
                size="sm"
                className="self-end"
                onClick={scheduleMaintenance}
                disabled={maintenanceLoading || !maintenanceStart || !maintenanceEnd}
              >
                {maintenanceLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Schedule'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Header with global actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Server className="w-5 h-5" />
          <span className="text-sm">{state?.serverHost || 'Loading...'}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => openConfirmDialog('update', null)}
            disabled={!!actionLoading}
          >
            {actionLoading === 'all' ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Download className="w-4 h-4 mr-2" />
            )}
            Update All
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={updateExtension}
            disabled={!!actionLoading}
          >
            {actionLoading === 'extension' ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Package className="w-4 h-4 mr-2" />
            )}
            Build Extension
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => openConfirmDialog('restart', null)}
            disabled={!!actionLoading}
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            Restart All
          </Button>
          <Button variant="outline" size="sm" onClick={fetchStatus} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Services Grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {state?.services.map((service) => (
          <Card key={service.ID} className="border-border/50 bg-card/50 backdrop-blur">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {getStatusIcon(service)}
                  <div>
                    <CardTitle className="text-base">{service.Name}</CardTitle>
                    <CardDescription className="text-xs">
                      Service: {service.Service}
                    </CardDescription>
                  </div>
                </div>
                {getStatusBadge(service)}
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                {service.State?.toLowerCase() === 'running' ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openConfirmDialog('stop', service.Service)}
                      disabled={actionLoading === service.Service}
                    >
                      {actionLoading === service.Service ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                      <span className="ml-2">Stop</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openConfirmDialog('restart', service.Service)}
                      disabled={actionLoading === service.Service}
                    >
                      {actionLoading === service.Service ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <RotateCcw className="w-4 h-4" />
                      )}
                      <span className="ml-2">Restart</span>
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openConfirmDialog('start', service.Service)}
                    disabled={actionLoading === service.Service}
                  >
                    {actionLoading === service.Service ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                    <span className="ml-2">Start</span>
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => fetchLogs(service.Service)}
                >
                  <Terminal className="w-4 h-4" />
                  <span className="ml-2">Logs</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openConfirmDialog('update', service.Service)}
                  disabled={actionLoading === service.Service}
                >
                  {actionLoading === service.Service ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  <span className="ml-2">Update</span>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}

        {loading && !state && (
          <div className="col-span-2 flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && (!state?.services || state.services.length === 0) && (
          <div className="col-span-2 text-center py-12 text-muted-foreground">
            No services found or unable to connect to server
          </div>
        )}
      </div>

      {/* Logs Dialog */}
      <Dialog open={!!logs} onOpenChange={() => setLogs(null)}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Logs: {logsService}</DialogTitle>
            <DialogDescription>Last 100 lines</DialogDescription>
          </DialogHeader>
          <div className="bg-black/50 rounded-lg p-4 overflow-auto max-h-[60vh]">
            <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap">{logs}</pre>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => logsService && fetchLogs(logsService)}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
            <Button onClick={() => setLogs(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Update Output Dialog */}
      <Dialog open={!!updateOutput} onOpenChange={() => setUpdateOutput(null)}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Update Output</DialogTitle>
          </DialogHeader>
          <div className="bg-black/50 rounded-lg p-4 overflow-auto max-h-[60vh]">
            <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap">
              {updateOutput}
            </pre>
          </div>
          <DialogFooter>
            <Button onClick={() => setUpdateOutput(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog */}
      <Dialog
        open={confirmDialog?.open ?? false}
        onOpenChange={(open) => !open && setConfirmDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmDialog?.title}</DialogTitle>
            <DialogDescription>
              {confirmDialog?.action === 'update' ? (
                <>
                  This will pull the latest code from git, rebuild and restart{' '}
                  {confirmDialog?.service || 'all services'}. This may take a few minutes.
                </>
              ) : (
                <>
                  This action will {confirmDialog?.action} the{' '}
                  {confirmDialog?.service || 'all services'} on the production server.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialog(null)}>
              Cancel
            </Button>
            <Button
              variant={confirmDialog?.action === 'stop' ? 'destructive' : 'default'}
              onClick={() =>
                confirmDialog && executeAction(confirmDialog.action, confirmDialog.service)
              }
            >
              {confirmDialog?.action === 'stop' ? 'Stop' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
