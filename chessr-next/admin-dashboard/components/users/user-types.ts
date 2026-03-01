import type { AdminUser, UserRole, UserPlan } from '@/lib/types'

export interface LinkedAccount {
  id: string
  platform: string
  platform_username: string
  avatar_url?: string
  rating_bullet?: number
  rating_blitz?: number
  rating_rapid?: number
  linked_at: string
  unlinked_at?: string
  ratings_updated_at?: string | null
  hasCooldown?: boolean
  hoursRemaining?: number
}

export interface DiscordInfo {
  discord_id: string
  discord_username: string
  discord_avatar: string | null
  discord_linked_at: string
  discord_roles_synced_at: string | null
}

export interface LinkedAccountsData {
  active: LinkedAccount[]
  unlinked: LinkedAccount[]
  totalActive: number
  totalUnlinked: number
  discord: DiscordInfo | null
}

export type SortField = 'created_at' | 'plan_expiry' | 'last_activity'
export type SortOrder = 'asc' | 'desc'

export interface PlanStats {
  total: number
  free: number
  freetrial: number
  premium: number
  beta: number
  lifetime: number
}

export type { AdminUser, UserRole, UserPlan }
