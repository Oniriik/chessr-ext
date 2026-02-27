'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  MessageSquare,
  Send,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Wrench,
  Rocket,
  Megaphone,
  RefreshCw,
} from 'lucide-react'

interface Channel {
  id: string
  name: string
  parentId: string | null
  type: 'text' | 'announcement'
}

type Template = 'maintenance' | 'maintenanceEnd' | 'update' | 'announcement' | 'custom'

const templateConfig = {
  maintenance: {
    icon: Wrench,
    label: 'Maintenance Start',
    color: 'bg-orange-500/20 text-orange-400',
    defaultTitle: '🔧 Scheduled Maintenance',
    defaultDescription: 'Scheduled maintenance {{time}}\nWe\'ll be back as soon as possible!',
  },
  maintenanceEnd: {
    icon: CheckCircle2,
    label: 'Maintenance End',
    color: 'bg-green-500/20 text-green-400',
    defaultTitle: '✅ Maintenance Complete',
    defaultDescription: 'Chessr is back online. Enjoy your games!',
  },
  update: {
    icon: Rocket,
    label: 'Update',
    color: 'bg-blue-500/20 text-blue-400',
    defaultTitle: '🚀 New Update',
    defaultDescription: '',
  },
  announcement: {
    icon: Megaphone,
    label: 'Announcement',
    color: 'bg-purple-500/20 text-purple-400',
    defaultTitle: '📢 Announcement',
    defaultDescription: '',
  },
  custom: {
    icon: MessageSquare,
    label: 'Custom',
    color: 'bg-gray-500/20 text-gray-400',
    defaultTitle: '',
    defaultDescription: '',
  },
}

export function DiscordPanel() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [channelSearch, setChannelSearch] = useState('')

  // Form state
  const [selectedChannel, setSelectedChannel] = useState('')
  const [template, setTemplate] = useState<Template>('announcement')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [pingEveryone, setPingEveryone] = useState(true)

  // Maintenance schedule
  const [maintenanceStart, setMaintenanceStart] = useState<number | null>(null)
  const [maintenanceEnd, setMaintenanceEnd] = useState<number | null>(null)

  // Filter channels by search
  const filteredChannels = channels.filter((c) =>
    c.name.toLowerCase().includes(channelSearch.toLowerCase())
  )

  // Format maintenance time for preview (human-readable)
  function formatTimePreview(start: number | null, end: number | null): string {
    if (!start) return '(no schedule set)'
    const fmt = (ts: number) =>
      new Date(ts * 1000).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
      })
    const fmtShort = (ts: number) =>
      new Date(ts * 1000).toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true,
      })
    if (!end) return `on ${fmt(start)}`
    // Same day check
    const dStart = new Date(start * 1000)
    const dEnd = new Date(end * 1000)
    const sameDay = dStart.toDateString() === dEnd.toDateString()
    return sameDay
      ? `from ${fmt(start)} to ${fmtShort(end)}`
      : `from ${fmt(start)} to ${fmt(end)}`
  }

  // Format maintenance time for Discord (dynamic timestamps)
  function formatTimeDiscord(start: number | null, end: number | null): string {
    if (!start) return ''
    if (!end) return `on <t:${start}:F> (<t:${start}:R>)`
    return `from <t:${start}:F> to <t:${end}:t> (<t:${start}:R>)`
  }

  // Replace {{time}} in a string
  function replaceTime(text: string, replacement: string): string {
    return text.replace(/\{\{time\}\}/g, replacement)
  }

  // Preview description with {{time}} resolved
  const previewDescription = description.includes('{{time}}')
    ? replaceTime(description, formatTimePreview(maintenanceStart, maintenanceEnd))
    : description

  useEffect(() => {
    fetchChannels()
  }, [])

  useEffect(() => {
    // Update form when template changes
    const config = templateConfig[template]
    setTitle(config.defaultTitle)
    setDescription(config.defaultDescription)
    // Fetch maintenance schedule when maintenance template is selected
    if (template === 'maintenance') {
      fetchMaintenanceSchedule()
    }
  }, [template])

  const fetchMaintenanceSchedule = async () => {
    try {
      const res = await fetch('/api/maintenance')
      if (res.ok) {
        const data = await res.json()
        if (data.scheduled) {
          setMaintenanceStart(data.startTimestamp)
          setMaintenanceEnd(data.endTimestamp)
        } else {
          setMaintenanceStart(null)
          setMaintenanceEnd(null)
        }
      }
    } catch {}
  }

  const fetchChannels = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/discord')
      const data = await response.json()

      if (response.ok) {
        setChannels(data.channels || [])
      } else {
        setError(data.error || 'Failed to fetch channels')
      }
    } catch {
      setError('Failed to connect to Discord API')
    } finally {
      setLoading(false)
    }
  }

  const sendMessage = async () => {
    if (!selectedChannel || !description.trim()) {
      setError('Please select a channel and enter a description')
      return
    }

    try {
      setSending(true)
      setError(null)
      setSuccess(null)

      // Replace {{time}} with Discord dynamic timestamps before sending
      const finalDescription = description.includes('{{time}}')
        ? replaceTime(description, formatTimeDiscord(maintenanceStart, maintenanceEnd))
        : description

      const response = await fetch('/api/discord', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: selectedChannel,
          template,
          title,
          description: finalDescription,
          pingEveryone,
        }),
      })

      const data = await response.json()

      if (response.ok) {
        setSuccess(`Message sent successfully via ${data.method}`)
        if (template !== 'custom') {
          setDescription(templateConfig[template].defaultDescription)
        }
      } else {
        setError(data.error || 'Failed to send message')
      }
    } catch {
      setError('Failed to send message')
    } finally {
      setSending(false)
    }
  }

  const quickUpdateStatus = async (maintenance: boolean) => {
    try {
      setSending(true)
      setError(null)
      setSuccess(null)

      const response = await fetch('/api/discord', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template: maintenance ? 'maintenance' : 'maintenanceEnd',
          statusOnly: true,
        }),
      })

      const data = await response.json()

      if (response.ok) {
        setSuccess(`Status updated to ${maintenance ? 'Maintenance' : 'Working'}`)
      } else {
        setError(data.error || 'Failed to update status')
      }
    } catch {
      setError('Failed to update status')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Quick Actions */}
      <Card className="border-border/50 bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="w-5 h-5 text-orange-400" />
            Quick Actions
          </CardTitle>
          <CardDescription>
            Toggle server status (updates Discord voice channel)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Button
              onClick={() => quickUpdateStatus(true)}
              disabled={sending}
              variant="outline"
              className="border-orange-500/50 hover:bg-orange-500/20"
            >
              {sending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Wrench className="w-4 h-4 mr-2" />
              )}
              Start Maintenance
            </Button>
            <Button
              onClick={() => quickUpdateStatus(false)}
              disabled={sending}
              variant="outline"
              className="border-green-500/50 hover:bg-green-500/20"
            >
              {sending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <CheckCircle2 className="w-4 h-4 mr-2" />
              )}
              End Maintenance
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Custom Message */}
      <Card className="border-border/50 bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-blue-400" />
            Send Custom Message
          </CardTitle>
          <CardDescription>
            Create and send custom embed messages to Discord
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Channel Selection */}
          <div>
            <Label className="text-sm text-muted-foreground mb-2 block">
              Select Channel
            </Label>
            <div className="flex gap-2">
              <Select value={selectedChannel} onValueChange={setSelectedChannel}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select a channel..." />
                </SelectTrigger>
                <SelectContent>
                  <div className="p-2">
                    <Input
                      placeholder="Search channels..."
                      value={channelSearch}
                      onChange={(e) => setChannelSearch(e.target.value)}
                      className="h-8"
                    />
                  </div>
                  {filteredChannels.length === 0 ? (
                    <div className="p-2 text-sm text-muted-foreground text-center">
                      No channels found
                    </div>
                  ) : (
                    filteredChannels.map((channel) => (
                      <SelectItem key={channel.id} value={channel.id}>
                        <span className="flex items-center gap-2">
                          #{channel.name}
                          {channel.type === 'announcement' && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                              📢
                            </Badge>
                          )}
                        </span>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <Button
                onClick={fetchChannels}
                disabled={loading}
                variant="ghost"
                size="icon"
                title="Refresh channels"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>

          {/* Template Selection */}
          <div className="flex flex-wrap gap-2">
            {(Object.keys(templateConfig) as Template[]).map((t) => {
              const config = templateConfig[t]
              const Icon = config.icon
              return (
                <Badge
                  key={t}
                  variant="outline"
                  className={`cursor-pointer transition-all ${
                    template === t
                      ? config.color + ' border-current'
                      : 'opacity-50 hover:opacity-100'
                  }`}
                  onClick={() => setTemplate(t)}
                >
                  <Icon className="w-3 h-3 mr-1" />
                  {config.label}
                </Badge>
              )
            })}
          </div>

          {/* Title */}
          <div>
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Message title..."
              className="mt-1"
            />
          </div>

          {/* Description */}
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Message content..."
              rows={4}
              className="mt-1"
            />
          </div>

          {/* Ping @everyone toggle */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="ping-everyone"
              checked={pingEveryone}
              onCheckedChange={(checked) => setPingEveryone(checked === true)}
            />
            <Label htmlFor="ping-everyone" className="text-sm cursor-pointer">
              Ping @everyone
            </Label>
          </div>

          {/* Preview */}
          <div className="border border-border/50 rounded-lg p-4 bg-[#2f3136]">
            <p className="text-xs text-muted-foreground mb-2">Preview</p>
            {pingEveryone && (
              <p className="text-blue-400 mb-2">@everyone</p>
            )}
            <div className="border-l-4 border-blue-500 pl-3">
              <p className="font-semibold text-white">{title || 'Title'}</p>
              <p className="text-sm text-gray-300 mt-1 whitespace-pre-wrap">
                {previewDescription || 'Description...'}
              </p>
              <p className="text-xs text-gray-500 mt-2">Today at {new Date().toLocaleTimeString()}</p>
            </div>
          </div>

          {/* Status Messages */}
          {error && (
            <div className="flex items-center gap-2 text-red-400 text-sm">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 text-green-400 text-sm">
              <CheckCircle2 className="w-4 h-4" />
              {success}
            </div>
          )}

          {/* Send Button */}
          <Button
            onClick={sendMessage}
            disabled={sending || !selectedChannel || !description.trim()}
            className="w-full"
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Send className="w-4 h-4 mr-2" />
            )}
            Send Message
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
