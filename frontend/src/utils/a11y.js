export function activateOnKey(onActivate) {
  if (!onActivate) return undefined;
  return (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onActivate(event);
  };
}
