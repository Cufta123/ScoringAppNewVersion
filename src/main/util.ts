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
