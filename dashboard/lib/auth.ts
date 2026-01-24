import { supabase } from './supabase'

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function isAdmin(email: string | null | undefined): Promise<boolean> {
  if (!email) return false

  const adminEmails = process.env.ADMIN_EMAILS?.split(',').map(e => e.trim()) || []
  return adminEmails.includes(email)
}

export async function checkAdminAccess(): Promise<{ isAdmin: boolean; email: string | null }> {
  const user = await getCurrentUser()
  const email = user?.email || null
  const admin = await isAdmin(email)

  return { isAdmin: admin, email }
}
