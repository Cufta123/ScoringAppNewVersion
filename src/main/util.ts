/* eslint import/prefer-default-export: off */
import { URL } from 'url';
import path from 'path';

/**
 * The page the main window loads. `npm start` (electron-vite dev) serves the
 * renderer from its dev server, with hot reload, and says where in
 * ELECTRON_RENDERER_URL; every other run loads the built page beside the
 * main bundle's folder (release/app/dist/renderer, or the packaged copy).
 */
export function resolveHtmlPath(htmlFileName: string) {
  const devServer = process.env.ELECTRON_RENDERER_URL;
  if (process.env.NODE_ENV === 'development' && devServer) {
    const url = new URL(devServer);
    url.pathname = htmlFileName;
    return url.href;
  }
  const filePath = path.resolve(__dirname, '../renderer/', htmlFileName);
  return `file://${filePath}`;
}

/**
 * The preload bundle, built beside the main bundle's folder (out/preload in
 * dev, release/app/dist/preload in the build and the packaged app).
 */
export function resolvePreloadPath(): string {
  return path.resolve(__dirname, '../preload/preload.js');
}

/**
 * Whether the window may navigate from `current` to `target`: only to the same
 * page (a reload, or another route of the hash router). Anything else, such as
 * a file dropped on the window, would replace the app with that file, and the
 * packaged app has no Reload in its menu to come back.
 */
export function isSameAppPage(target: string, current: string): boolean {
  const withoutHash = (value: string) => value.split('#')[0];
  return Boolean(current) && withoutHash(target) === withoutHash(current);
}

/** Only web links are handed to the system browser, never file: or app: links. */
export function isWebLink(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}
