import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'

export async function GET() {
  try {
    const supabase = getServiceRoleClient()

    const { data, error } = await supabase
      .from('user_settings')
      .select('signup_country, signup_country_code')
      .not('signup_country_code', 'is', null)

    if (error) {
      console.error('Map API error:', error)
      return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 })
    }

    // Aggregate by country code
    const countryMap = new Map<string, { country: string; code: string; count: number }>()
    for (const row of data || []) {
      const code = row.signup_country_code
      if (!code) continue
      const existing = countryMap.get(code)
      if (existing) {
        existing.count++
      } else {
        countryMap.set(code, {
          country: row.signup_country || code,
          code,
          count: 1,
        })
      }
    }

    const countries = Array.from(countryMap.values()).sort((a, b) => b.count - a.count)
    const total = countries.reduce((sum, c) => sum + c.count, 0)

    return NextResponse.json({ countries, total })
  } catch (error) {
    console.error('Map API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
