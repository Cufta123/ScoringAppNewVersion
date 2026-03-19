/* eslint-disable no-alert */

export const getErrorMessage = (error) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  if (error && typeof error === 'object' && typeof error.message === 'string') {
    return error.message;
  }

  return 'Unexpected error. Please try again.';
};

export const reportError = (title, error) => {
  const details = getErrorMessage(error);
  const message = title ? `${title}\n\n${details}` : details;
  window.alert(message);
};

export const reportInfo = (message, title = 'Notice') => {
  const body = message || 'Done.';
  window.alert(`${title}\n\n${body}`);
};

export const confirmAction = (message, title = 'Please confirm') => {
  const body = message || 'Are you sure you want to continue?';
  return window.confirm(`${title}\n\n${body}`);
};
