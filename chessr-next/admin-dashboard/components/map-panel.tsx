'use client'

import { useEffect, useState, useCallback, memo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { RefreshCw, Loader2, Globe, Users } from 'lucide-react'
import {
  ComposableMap,
  Geographies,
  Geography,
  ZoomableGroup,
} from 'react-simple-maps'

const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'

// ISO 3166-1 numeric → alpha-2 mapping (world-atlas uses numeric IDs)
const NUMERIC_TO_ALPHA2: Record<string, string> = {
  '004': 'AF', '008': 'AL', '012': 'DZ', '020': 'AD', '024': 'AO', '028': 'AG',
  '032': 'AR', '051': 'AM', '036': 'AU', '040': 'AT', '031': 'AZ', '044': 'BS',
  '048': 'BH', '050': 'BD', '052': 'BB', '112': 'BY', '056': 'BE', '084': 'BZ',
  '204': 'BJ', '064': 'BT', '068': 'BO', '070': 'BA', '072': 'BW', '076': 'BR',
  '096': 'BN', '100': 'BG', '854': 'BF', '108': 'BI', '132': 'CV', '116': 'KH',
  '120': 'CM', '124': 'CA', '140': 'CF', '148': 'TD', '152': 'CL', '156': 'CN',
  '170': 'CO', '174': 'KM', '178': 'CG', '180': 'CD', '188': 'CR', '384': 'CI',
  '191': 'HR', '192': 'CU', '196': 'CY', '203': 'CZ', '208': 'DK', '262': 'DJ',
  '212': 'DM', '214': 'DO', '218': 'EC', '818': 'EG', '222': 'SV', '226': 'GQ',
  '232': 'ER', '233': 'EE', '231': 'ET', '242': 'FJ', '246': 'FI', '250': 'FR',
  '266': 'GA', '270': 'GM', '268': 'GE', '276': 'DE', '288': 'GH', '300': 'GR',
  '308': 'GD', '320': 'GT', '324': 'GN', '624': 'GW', '328': 'GY', '332': 'HT',
  '340': 'HN', '348': 'HU', '352': 'IS', '356': 'IN', '360': 'ID', '364': 'IR',
  '368': 'IQ', '372': 'IE', '376': 'IL', '380': 'IT', '388': 'JM', '392': 'JP',
  '400': 'JO', '398': 'KZ', '404': 'KE', '296': 'KI', '408': 'KP', '410': 'KR',
  '414': 'KW', '417': 'KG', '418': 'LA', '428': 'LV', '422': 'LB', '426': 'LS',
  '430': 'LR', '434': 'LY', '438': 'LI', '440': 'LT', '442': 'LU', '450': 'MG',
  '454': 'MW', '458': 'MY', '462': 'MV', '466': 'ML', '470': 'MT', '584': 'MH',
  '478': 'MR', '480': 'MU', '484': 'MX', '583': 'FM', '498': 'MD', '492': 'MC',
  '496': 'MN', '499': 'ME', '504': 'MA', '508': 'MZ', '104': 'MM', '516': 'NA',
  '520': 'NR', '524': 'NP', '528': 'NL', '554': 'NZ', '558': 'NI', '562': 'NE',
  '566': 'NG', '807': 'MK', '578': 'NO', '512': 'OM', '586': 'PK', '585': 'PW',
  '591': 'PA', '598': 'PG', '600': 'PY', '604': 'PE', '608': 'PH', '616': 'PL',
  '620': 'PT', '634': 'QA', '642': 'RO', '643': 'RU', '646': 'RW', '659': 'KN',
  '662': 'LC', '670': 'VC', '882': 'WS', '674': 'SM', '678': 'ST', '682': 'SA',
  '686': 'SN', '688': 'RS', '690': 'SC', '694': 'SL', '702': 'SG', '703': 'SK',
  '705': 'SI', '090': 'SB', '706': 'SO', '710': 'ZA', '724': 'ES', '144': 'LK',
  '736': 'SD', '740': 'SR', '748': 'SZ', '752': 'SE', '756': 'CH', '760': 'SY',
  '762': 'TJ', '834': 'TZ', '764': 'TH', '626': 'TL', '768': 'TG', '776': 'TO',
  '780': 'TT', '788': 'TN', '792': 'TR', '795': 'TM', '798': 'TV', '800': 'UG',
  '804': 'UA', '784': 'AE', '826': 'GB', '840': 'US', '858': 'UY', '860': 'UZ',
  '548': 'VU', '862': 'VE', '704': 'VN', '887': 'YE', '894': 'ZM', '716': 'ZW',
  '-99': 'XK', '275': 'PS', '016': 'AS', '158': 'TW', '630': 'PR', '652': 'BL',
  '531': 'CW', '534': 'SX', '535': 'BQ',
}

interface CountryData {
  country: string
  code: string
  count: number
}

// Color scale: transparent → blue
function getColor(count: number, maxCount: number): string {
  if (count === 0) return '#1e293b' // slate-800 for no data
  const intensity = Math.pow(count / maxCount, 0.4) // pow for better distribution
  const r = Math.round(30 + (59 - 30) * (1 - intensity))
  const g = Math.round(41 + (130 - 41) * (1 - intensity))
  const b = Math.round(59 + (246 - 59) * intensity)
  return `rgb(${r}, ${g}, ${b})`
}

const MapChart = memo(function MapChart({
  countryMap,
  maxCount,
}: {
  countryMap: Map<string, CountryData>
  maxCount: number
}) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; content: string } | null>(null)

  return (
    <div className="relative">
      {tooltip && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-border/50 bg-popover px-3 py-1.5 text-sm shadow-md"
          style={{ left: tooltip.x, top: tooltip.y, transform: 'translate(-50%, -120%)' }}
        >
          {tooltip.content}
        </div>
      )}
      <ComposableMap
        projectionConfig={{ rotate: [-10, 0, 0], scale: 147 }}
        style={{ width: '100%', height: 'auto' }}
      >
        <ZoomableGroup>
          <Geographies geography={GEO_URL}>
            {({ geographies }) =>
              geographies.map((geo) => {
                const numericId = geo.id || geo.properties?.iso_n3
                const alpha2 = NUMERIC_TO_ALPHA2[numericId] || ''
                const data = countryMap.get(alpha2)
                const count = data?.count || 0
                const name = geo.properties?.name || alpha2

                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={getColor(count, maxCount)}
                    stroke="#334155"
                    strokeWidth={0.5}
                    style={{
                      default: { outline: 'none' },
                      hover: { outline: 'none', fill: count > 0 ? '#3b82f6' : '#334155' },
                      pressed: { outline: 'none' },
                    }}
                    onMouseEnter={(evt) => {
                      const label = count > 0 ? `${name}: ${count} user${count > 1 ? 's' : ''}` : name
                      setTooltip({ x: evt.clientX, y: evt.clientY, content: label })
                    }}
                    onMouseMove={(evt) => {
                      setTooltip((prev) =>
                        prev ? { ...prev, x: evt.clientX, y: evt.clientY } : null,
                      )
                    }}
                    onMouseLeave={() => setTooltip(null)}
                  />
                )
              })
            }
          </Geographies>
        </ZoomableGroup>
      </ComposableMap>
    </div>
  )
})

export function MapPanel() {
  const [countries, setCountries] = useState<CountryData[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/map')
      const data = await res.json()
      setCountries(data.countries || [])
      setTotal(data.total || 0)
    } catch (e) {
      console.error('Failed to fetch map data:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const countryMap = new Map(countries.map((c) => [c.code, c]))
  const maxCount = countries.length > 0 ? countries[0].count : 1

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      {/* Map (left/main) */}
      <div className="flex-1 min-w-0">
        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">User Distribution</CardTitle>
            <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex h-[400px] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <MapChart countryMap={countryMap} maxCount={maxCount} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Sidebar (right on desktop, below on mobile) */}
      <div className="w-full space-y-4 lg:w-72 xl:w-80 shrink-0">
        {/* Stats */}
        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-lg bg-blue-500/10 p-2">
              <Globe className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{countries.length}</p>
              <p className="text-xs text-muted-foreground">Countries</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-lg bg-emerald-500/10 p-2">
              <Users className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{total}</p>
              <p className="text-xs text-muted-foreground">Users with country</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-lg bg-purple-500/10 p-2">
              <Globe className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{countries[0]?.country || '—'}</p>
              <p className="text-xs text-muted-foreground">Top country ({countries[0]?.count || 0})</p>
            </div>
          </CardContent>
        </Card>

        {/* Country list */}
        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Countries</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[400px] space-y-1 overflow-y-auto">
              {countries.map((c, i) => (
                <div key={c.code} className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-muted/50">
                  <div className="flex items-center gap-2">
                    <span className="w-5 text-right text-xs text-muted-foreground">{i + 1}.</span>
                    <span className="text-sm font-medium">{c.country}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-blue-500"
                        style={{ width: `${(c.count / maxCount) * 100}%` }}
                      />
                    </div>
                    <span className="w-8 text-right text-xs font-mono">
                      {c.count}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
