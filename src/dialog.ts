// Keyboard and screen-reader behaviour for a dialog: focus moves into it when it opens, Tab stays inside it,
// and focus goes back to where it was when it closes.
import { useEffect, type RefObject } from 'react';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function useDialog(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const items = () => [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => !n.closest('[hidden],[inert]') && getComputedStyle(n).visibility !== 'hidden');
    // the dialog itself takes focus (not a field: that would open the keyboard on a phone), so the first Tab lands inside it
    el.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const list = items();
      if (!list.length) {
        e.preventDefault();
        return;
      }
      const at = document.activeElement as HTMLElement | null;
      const inside = !!at && el.contains(at) && at !== el;
      if (e.shiftKey && (!inside || at === list[0])) {
        e.preventDefault();
        list[list.length - 1].focus();
      } else if (!e.shiftKey && (!inside || at === list[list.length - 1])) {
        e.preventDefault();
        list[0].focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      if (before && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, [ref]);
}
