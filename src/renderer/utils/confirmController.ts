// Bridges the imperative `confirmAction(...)` utility (callable from any event
// handler) to the React <ConfirmDialogHost /> mounted at the app root. The host
// registers a handler on mount; `confirmAction` delegates to it and awaits the
// user's choice. This keeps confirmation dialogs inside the React tree instead
// of building DOM nodes by hand.

export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  confirmClassName: string;
}

export type ConfirmHandler = (request: ConfirmRequest) => Promise<boolean>;

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

export const requestConfirm = (request: ConfirmRequest): Promise<boolean> => {
  if (!activeHandler) {
    return Promise.resolve(false);
  }
  return activeHandler(request);
};
