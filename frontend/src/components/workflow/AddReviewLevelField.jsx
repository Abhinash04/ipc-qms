import { PlusIcon } from 'lucide-react';

import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { MOCK_USERS } from '@/constants/mockUsers';
import { ROLES } from '@/constants/roles';

const ELIGIBLE_REVIEWERS = MOCK_USERS.filter((u) => u.role === ROLES.REVIEWER);

export function AddReviewLevelField({ label, value, onChange, onAdd }) {
  return (
    <div className="space-y-1.5 border-t border-border pt-3">
      <Label htmlFor="new-reviewer">{label}</Label>
      <div className="flex gap-2">
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger id="new-reviewer" className="flex-1">
            <SelectValue placeholder="Select reviewer" />
          </SelectTrigger>
          <SelectContent>
            {ELIGIBLE_REVIEWERS.map((user) => (
              <SelectItem key={user.id} value={user.id}>
                {user.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="secondary" disabled={!value} onClick={onAdd}>
          <PlusIcon className="h-4 w-4" aria-hidden="true" />
          Add
        </Button>
      </div>
    </div>
  );
}
