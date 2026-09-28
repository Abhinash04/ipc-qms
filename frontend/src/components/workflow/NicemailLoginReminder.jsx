import { useState } from 'react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/useAuthStore';
import { ROLES } from '@/constants/roles';

const NICEMAIL_LOGIN_URL =
  'https://accounts.mgovcloud.in/signin?servicename=VirtualOffice&serviceurl=https%3A%2F%2Fworkplace.mgovcloud.in%2F';

export function NicemailLoginReminder() {
  const role = useAuthStore((state) => state.currentUser?.role);
  const [open, setOpen] = useState(true);

  if (role !== ROLES.FRONT_OFFICE) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>NICeMail Login Required</DialogTitle>
          <DialogDescription>
            Please log in to the NICeMail service to enable the Browser Agent to access and
            synchronize your mailbox. Ensure that you are logged in before proceeding.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
          <Button asChild>
            <a href={NICEMAIL_LOGIN_URL} target="_blank" rel="noopener noreferrer">
              Login to NICeMail
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
