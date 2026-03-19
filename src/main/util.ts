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
