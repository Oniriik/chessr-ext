import { useState, useEffect, useRef, RefObject } from 'react';

/**
 * Hook that tracks the width of a container element using ResizeObserver.
 * Returns a ref to attach to the container and the current width.
 */
export function useContainerWidth<T extends HTMLElement = HTMLDivElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });

    observer.observe(element);
    // Set initial width
    setWidth(element.getBoundingClientRect().width);

    return () => observer.disconnect();
  }, []);

  return [ref, width];
}
