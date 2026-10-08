import { useEffect, useState } from 'react';
import { fetchAssignableOfficials } from '@/services/api/aiService';
import { MOCK_USERS } from '@/constants/mockUsers';
import { ROLES } from '@/constants/roles';

const BUILT_IN_OFFICIALS = MOCK_USERS.filter((user) => user.role === ROLES.ASSIGNED_OFFICIAL);

/**
 * The Assigned Officials a case can be assigned or transferred to, read from the server so an
 * officer an administrator approved appears without a release. The built-in officials stand in
 * until it answers, or if it cannot.
 */
export function useAssignableOfficials() {
  const [officials, setOfficials] = useState(null);

  useEffect(() => {
    let live = true;
    void fetchAssignableOfficials().then((list) => {
      if (live && list?.length) setOfficials(list);
    });
    return () => {
      live = false;
    };
  }, []);

  return officials ?? BUILT_IN_OFFICIALS;
}
