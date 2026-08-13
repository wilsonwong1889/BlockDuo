import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useBackHandler } from '../native/useBackHandler';
import { focusableWithin, nextFocusIndex } from './focusTrap';
import { openModal } from './modalStack';

interface Props {
  title: string;
  /** Extra class on the panel, for dialogs with their own layout. */
  panelClassName?: string;
  /**
   * Whether Escape and the Android back button close this dialog. A finished
   * game has no "cancel", so GameOver opts out and back leaves for Home.
   */
  dismissible?: boolean;
  onDismiss?: () => void;
  children: ReactNode;
}

export function Modal({
  title,
  panelClassName,
  dismissible = true,
  onDismiss,
  children,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => openModal(), []);

  useBackHandler(() => {
    if (!dismissible) return false;
    onDismiss?.();
    return true;
  });

  // Whatever was focused when this dialog opened, read during render rather
  // than in the effect below: React applies autoFocus while committing, so by
  // the time an effect runs the dialog's own button already holds focus and the
  // control that opened it has been lost.
  const openerRef = useRef<HTMLElement | null>(null);
  if (openerRef.current === null) {
    openerRef.current = document.activeElement as HTMLElement | null;
  }

  // Send focus into the dialog, and put it back on close. Without the restore,
  // closing Settings drops focus to the document body and a keyboard player
  // starts again from the top of the screen behind it.
  useEffect(() => {
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) {
      const [first] = focusableWithin(panel);
      (first ?? panel).focus();
    }
    return () => {
      const opener = openerRef.current;
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const panel = panelRef.current;
      if (!panel) return;

      if (event.key === 'Escape' && dismissible) {
        event.preventDefault();
        onDismiss?.();
        return;
      }

      if (event.key !== 'Tab') return;

      // Tab is driven by hand rather than left to the browser, which is the
      // only way to stop it walking out of the dialog and into the game behind.
      const items = focusableWithin(panel);
      event.preventDefault();
      if (items.length === 0) return;
      const index = items.indexOf(document.activeElement as HTMLElement);
      items[nextFocusIndex(items.length, index, event.shiftKey)]?.focus();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dismissible, onDismiss]);

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div
        ref={panelRef}
        className={panelClassName ? `panel ${panelClassName}` : 'panel'}
        tabIndex={-1}
      >
        <h2 className="panel-title" id={titleId}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
