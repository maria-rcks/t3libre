import { useEffect, useRef, useCallback } from 'react';

export function useFocusTrap(active: boolean) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active || !ref.current) return;

    const container = ref.current;
    const selector = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(selector));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    const firstFocusable = container.querySelector<HTMLElement>(selector);
    firstFocusable?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [active]);

  return ref;
}

export function useAnnounce() {
  const regionRef = useRef<HTMLDivElement>(null);

  const announce = useCallback((message: string, priority: 'polite' | 'assertive' = 'polite') => {
    const region = regionRef.current;
    if (!region) return;
    region.textContent = '';
    setTimeout(() => { region.textContent = message; }, 50);
  }, []);

  return { regionRef, announce };
}

export function useAriaId(prefix: string) {
  const id = useRef(`${prefix}-${Math.random().toString(36).slice(2, 9)}`);
  return id.current;
}
