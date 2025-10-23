import { ReactNode, useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([type="hidden"]):not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  labelledBy?: string;
  describedBy?: string;
  id?: string;
  children: ReactNode;
}

export const Modal = ({ isOpen, onClose, labelledBy, describedBy, id, children }: ModalProps) => {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (typeof window === 'undefined') {
      return;
    }

    previouslyFocusedElement.current = document.activeElement as HTMLElement | null;

    const handleKeyDown = (event: KeyboardEvent) => {
      const content = contentRef.current;
      if (!content) {
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const focusable = Array.from(content.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)).filter(
        (element) => element.offsetParent !== null || element === document.activeElement
      );

      if (focusable.length === 0) {
        event.preventDefault();
        content.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (current === first || !current || !content.contains(current)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (current === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const content = contentRef.current;
    const previousOverflow = document.body.style.overflow;

    const focusTarget = () => {
      if (!content) {
        return;
      }
      const firstFocusable = content.querySelector<HTMLElement>(FOCUSABLE_SELECTORS);
      if (firstFocusable) {
        firstFocusable.focus({ preventScroll: true });
        return;
      }
      content.focus({ preventScroll: true });
    };

    document.body.style.overflow = 'hidden';
    focusTarget();
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      const lastFocused = previouslyFocusedElement.current;
      if (lastFocused && typeof lastFocused.focus === 'function') {
        lastFocused.focus({ preventScroll: true });
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  if (typeof document === 'undefined') {
    return null;
  }

  const handleOverlayClick = () => {
    onClose();
  };

  const handleContentClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

  return createPortal(
    <div className="ui-modalOverlay" role="presentation" onMouseDown={handleOverlayClick}>
      <div
        ref={contentRef}
        className="ui-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        id={id}
        tabIndex={-1}
        onMouseDown={handleContentClick}
      >
        {children}
      </div>
    </div>,
    document.body
  );
};

Modal.displayName = 'Modal';
