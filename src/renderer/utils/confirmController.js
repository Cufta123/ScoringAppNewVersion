// Bridges the imperative `confirmAction(...)` utility (callable from any event
// handler) to the React <ConfirmDialogHost /> mounted at the app root. The host
// registers a handler on mount; `confirmAction` delegates to it and awaits the
// user's choice. This keeps confirmation dialogs inside the React tree instead
// of building DOM nodes by hand.

let activeHandler = null;

export const registerConfirmHandler = (handler) => {
  activeHandler = handler;
  return () => {
    if (activeHandler === handler) {
      activeHandler = null;
    }
  };
};

export const hasConfirmHandler = () => typeof activeHandler === 'function';

export const requestConfirm = (request) => {
  if (!activeHandler) {
    return Promise.resolve(false);
  }
  return activeHandler(request);
};
