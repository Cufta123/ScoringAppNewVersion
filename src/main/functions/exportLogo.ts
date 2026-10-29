/**
 * What the main process accepts as an event's export logo. The window shrinks
 * the picture to 600 px before it is sent (renderer/exports/logo.ts); this is
 * the backstop that keeps anything else out of the database: only a PNG or
 * JPEG data URL, and not an unreasonable size.
 */

/** Largest stored logo, in characters of the data URL (about 2 MB of picture). */
export const MAX_LOGO_CHARS = 3 * 1024 * 1024;

const LOGO_PATTERN = /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;

export const isAcceptableLogo = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= MAX_LOGO_CHARS &&
  LOGO_PATTERN.test(value);
