import { useLayoutEffect, useRef, useState } from 'react';

export function useIsClamped(text, open = false) {
  const ref = useRef(null);
  const [clamped, setClamped] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = () => setClamped(element.scrollHeight - element.clientHeight > 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text, open]);

  return [ref, clamped];
}
