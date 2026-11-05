import type { WebContents } from 'electron';
import type { MainToWindowMessages } from '../shared/ipc';

/**
 * Send one of the main process's one-way messages to the window, with the
 * arguments the contract gives it (shared/ipc.ts, `MainToWindowMessages`).
 * Nothing is sent while there is no window.
 */
export default function sendToWindow<M extends keyof MainToWindowMessages>(
  contents: WebContents | undefined,
  message: M,
  ...args: Parameters<MainToWindowMessages[M]>
): void {
  contents?.send(message, ...args);
}
