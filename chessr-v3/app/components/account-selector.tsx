'use client'

import { ChevronDown } from 'lucide-react'

interface Account {
  id: string
  platform: string
  platform_username: string
}

interface AccountSelectorProps {
  accounts: Account[]
  selected: string | null
  onSelect: (username: string) => void
}

export function AccountSelector({ accounts, selected, onSelect }: AccountSelectorProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">Account:</span>
      <div className="relative">
        <select
          value={selected || ''}
          onChange={(e) => {
            onSelect(e.target.value)
            localStorage.setItem('chessr_selected_account', e.target.value)
          }}
          className="appearance-none bg-card/50 border border-border/40 rounded-xl px-3 py-1.5 pr-8 text-sm font-medium text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring backdrop-blur-sm"
        >
          {accounts.map((acc) => (
            <option key={acc.id} value={acc.platform_username}>
              {acc.platform_username}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
      </div>
    </div>
  )
}
