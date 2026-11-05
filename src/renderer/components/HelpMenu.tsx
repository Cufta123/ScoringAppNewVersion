import React, { useEffect, useId, useRef, useState } from 'react';

interface HelpMenuProps {
  onOpenHelp: () => void;
  onReportProblem: () => void;
}

/**
 * The navbar's Help button: a small menu with the help and glossary and
 * "Report a problem", the way desktop apps keep both under Help. Opens on
 * click, Enter or Space; arrow keys move, Escape closes and returns focus to
 * the button, a click outside or Tab closes it.
 */
function HelpMenu({ onOpenHelp, onReportProblem }: HelpMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const items = () =>
    [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]',
      ) ?? []),
    ] as HTMLButtonElement[];

  useEffect(() => {
    if (!open) return undefined;
    items()[0]?.focus();
    const closeOnOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutside);
    return () => document.removeEventListener('mousedown', closeOnOutside);
  }, [open]);

  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      // Only this menu: an open dialog underneath must not close too.
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      list[(index + 1) % list.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      list[(index - 1 + list.length) % list.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      list[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      list[list.length - 1]?.focus();
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div className="help-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="app-navbar-tool"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <i className="fa fa-circle-question" aria-hidden="true" />
        <span className="app-navbar-tool-label">Help</span>
        <i className="fa fa-chevron-down help-menu-caret" aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          className="help-menu-list"
          role="menu"
          aria-label="Help"
          tabIndex={-1}
          onKeyDown={onMenuKeyDown}
        >
          <button
            type="button"
            role="menuitem"
            className="help-menu-item"
            tabIndex={-1}
            onClick={() => choose(onOpenHelp)}
          >
            <i className="fa fa-book-open" aria-hidden="true" />
            <span>
              <span className="help-menu-item-title">Help and glossary</span>
              <span className="help-menu-item-note">
                How each screen works, and the terms used
              </span>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="help-menu-item"
            tabIndex={-1}
            onClick={() => choose(onReportProblem)}
          >
            <i className="fa fa-bug" aria-hidden="true" />
            <span>
              <span className="help-menu-item-title">Report a problem…</span>
              <span className="help-menu-item-note">
                Sends it to the developer, with this event&apos;s data
              </span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

export default HelpMenu;
