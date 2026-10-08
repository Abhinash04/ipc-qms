import { useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/store/useAuthStore';
import { MOCK_USERS } from '@/constants/mockUsers';
import { isObserver } from '@/constants/workflowRules';

const PARAM = 'user';

// The Super Admin picks whose work a page shows; the choice lives in the URL so the view can be shared.
export function useWatchedUser(roles) {
  const currentUser = useAuthStore((state) => state.currentUser);
  const [searchParams, setSearchParams] = useSearchParams();
  const observer = isObserver(currentUser);

  const options = observer ? MOCK_USERS.filter((user) => roles.includes(user.role)) : [];
  const watched = options.find((user) => user.id === searchParams.get(PARAM)) || null;

  const watch = (userId) =>
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (userId) next.set(PARAM, userId);
        else next.delete(PARAM);
        return next;
      },
      { replace: true },
    );

  return { observer, options, watched, watch };
}
