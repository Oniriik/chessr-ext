import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json()
    const adminStatus = await isAdmin(email)

    return NextResponse.json({ isAdmin: adminStatus })
  } catch (error) {
    return NextResponse.json({ isAdmin: false }, { status: 500 })
  }
}
