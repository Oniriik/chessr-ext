export type UserRole = 'super_admin' | 'admin' | 'user'
export type UserPlan = 'free' | 'freetrial' | 'premium' | 'beta' | 'lifetime'

export interface AdminUser {
  id: string
  user_id: string
  email: string
  role: UserRole
  plan: UserPlan
  plan_expiry: string | null
  created_at: string
  last_sign_in_at: string | null
  email_confirmed: boolean
  linked_count: number
  last_activity: string | null
  banned: boolean
  ban_reason: string | null
  banned_at: string | null
  banned_by: string | null
}

export interface AuthState {
  user: AdminUser | null
  loading: boolean
  error: string | null
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  totalPages: number
}

// Permission helpers
export const canModifyRoles = (role: UserRole): boolean => role === 'super_admin'
export const canModifyPlans = (role: UserRole): boolean =>
  role === 'super_admin' || role === 'admin'
export const canAccessDashboard = (role: UserRole): boolean =>
  role === 'super_admin' || role === 'admin'

// Plan display helpers
export const planLabels: Record<UserPlan, string> = {
  free: 'Free',
  freetrial: 'Free Trial',
  premium: 'Premium',
  beta: 'Beta',
  lifetime: 'Lifetime',
}

export const roleLabels: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  user: 'User',
}

export const planColors: Record<UserPlan, string> = {
  free: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
  freetrial: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  premium: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  beta: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  lifetime: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
}

export const roleColors: Record<UserRole, string> = {
  super_admin: 'bg-red-500/20 text-red-400 border-red-500/30',
  admin: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  user: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
}
