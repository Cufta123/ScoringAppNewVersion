/* eslint import/prefer-default-export: off */
import { URL } from 'url';
import path from 'path';
import fs from 'fs';

export function resolveHtmlPath(htmlFileName: string) {
  const filePath = path.resolve(__dirname, '../renderer/', htmlFileName);
  // In development prefer the dev server URL, but if the built file exists
  // (e.g. when running a packaged/unpacked release) prefer the file URL.
  if (process.env.NODE_ENV === 'development') {
    const port = process.env.PORT || 1212;
    const url = new URL(`http://localhost:${port}`);
    url.pathname = htmlFileName;
    try {
      if (!fs.existsSync(filePath)) return url.href;
    } catch (_) {
      return url.href;
    }
  }

  return `file://${filePath}`;
}

export function resolvePreloadPath(): string {
  // Prefer the built preload that sits next to the main bundle — this is correct
  // both when packaged and when running an unpackaged production build. Fall back
  // to the dev DLL location only when that built file is absent.
  const builtPreload = path.resolve(__dirname, 'preload.js');
  try {
    if (fs.existsSync(builtPreload)) return builtPreload;
  } catch (_) {
    // fall through to the dev path
  }
  return path.resolve(__dirname, '../../.erb/dll/preload.js');
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
