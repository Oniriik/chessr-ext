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
import { Loader2, Trash2 } from 'lucide-react'
import type { AdminUser } from './user-types'

interface UserDeleteDialogProps {
  deleteUser: AdminUser | null
  deletePassword: string
  deleting: boolean
  deleteError: string
  onClose: () => void
  onConfirm: () => void
  onSetDeletePassword: (password: string) => void
}

export function UserDeleteDialog({
  deleteUser,
  deletePassword,
  deleting,
  deleteError,
  onClose,
  onConfirm,
  onSetDeletePassword,
}: UserDeleteDialogProps) {
  return (
    <Dialog open={!!deleteUser} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-red-400">Delete User</DialogTitle>
          <DialogDescription>
            This will permanently delete <strong>{deleteUser?.email}</strong> and all associated data
            (settings, activity, linked accounts, IPs). This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Enter your password to confirm</label>
            <Input
              type="password"
              placeholder="Your admin password"
              value={deletePassword}
              onChange={(e) => onSetDeletePassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onConfirm()}
            />
            {deleteError && (
              <p className="text-sm text-red-400">{deleteError}</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={deleting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={deleting || !deletePassword}
          >
            {deleting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Deleting...
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4 mr-1" />
                Delete permanently
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
