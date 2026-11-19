import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const activeTrapStack: HTMLElement[] = [];

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const candidates = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return candidates.filter((el) => {
    if (el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true') {
      return false;
    }
    if (typeof window !== 'undefined') {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') {
        return false;
      }
    }
    return true;
  });
}

export interface UseFocusTrapOptions {
  enabled: boolean;
  onClose?: () => void;
  canClose?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
}

export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  { enabled, onClose, canClose = true, initialFocusRef }: UseFocusTrapOptions,
): void {
  const onCloseRef = useRef(onClose);
  const canCloseRef = useRef(canClose);
  onCloseRef.current = onClose;
  canCloseRef.current = canClose;

  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (!activeTrapStack.includes(container)) {
      activeTrapStack.push(container);
    }

    const focusInitial = () => {
      const target = initialFocusRef?.current;
      if (target && container.contains(target)) {
        target.focus();
        return;
      }
      const focusables = getFocusableElements(container);
      if (focusables.length > 0) {
        focusables[0].focus();
      } else {
        container.focus();
      }
    };

    const frameId = window.requestAnimationFrame(() => {
      if (activeTrapStack[activeTrapStack.length - 1] === container && !container.contains(document.activeElement)) {
        focusInitial();
      }
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (activeTrapStack[activeTrapStack.length - 1] !== container) {
        return;
      }

      if (event.key === 'Escape') {
        if (canCloseRef.current && onCloseRef.current) {
          event.preventDefault();
          event.stopPropagation();
          onCloseRef.current();
        }
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const focusables = getFocusableElements(container);
      if (focusables.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (!activeEl || !container.contains(activeEl) || activeEl === first || activeEl === container) {
          event.preventDefault();
          last.focus();
        }
      } else if (!activeEl || !container.contains(activeEl) || activeEl === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      window.cancelAnimationFrame(frameId);
      document.removeEventListener('keydown', handleKeyDown, true);

      const idx = activeTrapStack.lastIndexOf(container);
      if (idx !== -1) {
        activeTrapStack.splice(idx, 1);
      }

      if (previouslyFocused && previouslyFocused.isConnected) {
        window.requestAnimationFrame(() => {
          if (previouslyFocused.isConnected) {
            previouslyFocused.focus();
          }
        });
      }
    };
  }, [enabled, containerRef, initialFocusRef]);
}
