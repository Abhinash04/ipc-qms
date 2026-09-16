/**
 * Keyboard activation for elements that must stay non-native (rich card content
 * that HTML forbids inside a <button>) but still expose role="button".
 * Mirrors native button behaviour: Enter and Space trigger the click handler.
 */
export function activateOnKey(onActivate) {
  if (!onActivate) return undefined;
  return (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onActivate(event);
  };
}
