import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import AppModal from './AppModal';
import { registerConfirmHandler } from '../../utils/confirmController';

// Renders confirmation dialogs requested via `confirmAction(...)`. Only one
// dialog is shown at a time; concurrent requests resolve to `false`.
//
// The dialog chrome (overlay, focus trap, Escape handling, backdrop dismiss)
// lives in the shared <AppModal />; this host only owns the imperative bridge
// (the pending resolver and single-instance guard).
export default function ConfirmDialogHost() {
  const [request, setRequest] = useState(null);
  const resolverRef = useRef(null);

  const close = useCallback((value) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setRequest(null);
    if (resolve) {
      resolve(value);
    }
  }, []);

  useEffect(() => {
    const handler = (incoming) =>
      new Promise((resolve) => {
        // A second request while one is open is rejected rather than queued.
        if (resolverRef.current) {
          resolve(false);
          return;
        }
        resolverRef.current = resolve;
        setRequest(incoming);
      });

    return registerConfirmHandler(handler);
  }, []);

  if (!request) {
    return null;
  }

  const {
    title = 'Please confirm',
    body = 'Are you sure you want to continue?',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    confirmClassName = 'btn-danger',
  } = request;

  return createPortal(
    <AppModal
      open
      title={title}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      confirmClassName={confirmClassName}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    >
      {body}
    </AppModal>,
    document.body,
  );
}
