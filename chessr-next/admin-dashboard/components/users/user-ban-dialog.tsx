import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Loader2, Ban } from 'lucide-react'
import type { AdminUser } from './user-types'

const BAN_TEMPLATES = [
  'Disposable email usage',
  'Terms of Service violation',
  'Inappropriate behavior',
  'Suspicious activity',
]

interface UserBanDialogProps {
  banUser: AdminUser | null
  banReason: string
  banning: boolean
  onClose: () => void
  onConfirm: () => void
  onSetBanReason: (reason: string) => void
}

export function UserBanDialog({
  banUser,
  banReason,
  banning,
  onClose,
  onConfirm,
  onSetBanReason,
}: UserBanDialogProps) {
  return (
    <Dialog open={!!banUser} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-red-400">Ban User</DialogTitle>
          <DialogDescription>
            Ban <strong>{banUser?.email}</strong> from using Chessr. They will be disconnected and unable to log in.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Reason template</label>
            <div className="flex flex-wrap gap-2">
              {BAN_TEMPLATES.map((template) => (
                <Button
                  key={template}
                  variant="outline"
                  size="sm"
                  onClick={() => onSetBanReason(template)}
                  className={`text-xs ${banReason === template ? 'border-red-500/50 bg-red-500/10 text-red-400' : ''}`}
                >
                  {template}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Custom reason</label>
            <Input
              placeholder="Enter ban reason..."
              value={banReason}
              onChange={(e) => onSetBanReason(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={banning}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={banning}
          >
            {banning ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Banning...
              </>
            ) : (
              <>
                <Ban className="w-4 h-4 mr-1" />
                Ban user
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
