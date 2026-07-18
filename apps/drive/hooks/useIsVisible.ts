import { useState, useRef, useCallback } from "react";

/**
 * useIsVisible — tracks whether an element is currently in/near the viewport.
 *
 * Unlike a "latch" approach (once true, always true), this hook returns
 * `false` again when the element scrolls out of view.  This lets callers
 * cancel work (e.g. thumbnail downloads) for off-screen items when the
 * user scrolls quickly.
 *
 * @param rootMargin  Extra margin around the viewport (default "200px").
 * @returns [callbackRef, isVisible] — attach callbackRef to the element.
 */
export function useIsVisible(
  rootMargin = "200px",
): [React.RefCallback<HTMLElement>, boolean] {
  const [isVisible, setIsVisible] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const callbackRef = useCallback(
    (node: HTMLElement | null) => {
      // Cleanup previous observer
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }

      if (!node) return;

      const observer = new IntersectionObserver(
        ([entry]) => {
          setIsVisible(entry.isIntersecting);
        },
        { rootMargin },
      );

      observer.observe(node);
      observerRef.current = observer;
    },
    [rootMargin],
  );

  return [callbackRef, isVisible];
}
