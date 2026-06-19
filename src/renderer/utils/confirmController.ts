// Bridges the imperative `confirmAction(...)` utility (callable from any event
// handler) to the React <ConfirmDialogHost /> mounted at the app root. The host
// registers a handler on mount; `confirmAction` delegates to it and awaits the
// user's choice. This keeps confirmation dialogs inside the React tree instead
// of building DOM nodes by hand.

// A confirm dialog resolves to which button the user pressed: the primary
// ('confirm'), the optional middle button ('extra'), or 'cancel' (backdrop,
// Escape, or the cancel button). Two-button dialogs never return 'extra'.
export type ConfirmChoice = 'confirm' | 'extra' | 'cancel';

export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  confirmClassName: string;
  // Optional third action shown between Cancel and Confirm.
  extraLabel?: string;
  extraClassName?: string;
}

export type ConfirmHandler = (
  request: ConfirmRequest,
) => Promise<ConfirmChoice>;

let activeHandler: ConfirmHandler | null = null;

export const registerConfirmHandler = (
  handler: ConfirmHandler,
): (() => void) => {
  activeHandler = handler;
  return () => {
    if (activeHandler === handler) {
      activeHandler = null;
    }
  };
};

export const hasConfirmHandler = (): boolean =>
  typeof activeHandler === 'function';

export const requestConfirm = (
  request: ConfirmRequest,
): Promise<ConfirmChoice> => {
  if (!activeHandler) {
    return Promise.resolve('cancel');
  }
  return activeHandler(request);
};
