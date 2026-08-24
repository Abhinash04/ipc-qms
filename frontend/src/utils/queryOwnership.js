export function isQueryOwnedBy(query, user) {
  if (!query || !user) return false;
  return Boolean(
    (query.inquirer?.id && query.inquirer.id === user.id) ||
      (!query.inquirer?.id &&
        query.inquirer?.email?.toLowerCase() === user.email?.toLowerCase()),
  );
}
