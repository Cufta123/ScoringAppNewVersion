/**
 * Flag images for the exported documents, taken offline from the same package
 * the screens use (react-world-flags bundles every flag as an SVG data URL).
 * No new dependency and nothing is fetched.
 *
 * The documents get one image per country that appears in them; a country
 * without a flag (an unknown or empty code) is simply shown as its code.
 */
import Flag from 'react-world-flags';
import type { ReactElement } from 'react';
import { getFlagCode } from '../utils/leaderboardUtils';

/** A very detailed flag (a coat of arms) is left out rather than bloat a page. */
const MAX_FLAG_CHARS = 120_000;

type FlagFunction = (props: { code: string }) => ReactElement<{
  src?: string;
}> | null;

const cache = new Map<string, string | null>();

const flagFor = (iocCode: string): string | null => {
  if (cache.has(iocCode)) return cache.get(iocCode) ?? null;
  let image: string | null = null;
  try {
    // The package's Flag is a plain function component (no hooks), so calling
    // it returns the <img> element whose src is the SVG data URL.
    const element = (Flag as unknown as FlagFunction)({
      code: getFlagCode(iocCode),
    });
    const src = element?.props?.src;
    if (
      typeof src === 'string' &&
      src.startsWith('data:image/svg+xml') &&
      src.length <= MAX_FLAG_CHARS
    ) {
      image = src;
    }
  } catch {
    image = null;
  }
  cache.set(iocCode, image);
  return image;
};

/** Flag data URLs by country code, for the codes that have one. */
const flagImages = (codes: Iterable<string>): Record<string, string> => {
  const images: Record<string, string> = {};
  new Set(codes).forEach((code) => {
    const clean = String(code ?? '')
      .trim()
      .toUpperCase();
    if (!/^[A-Z0-9]{2,3}$/.test(clean)) return;
    const image = flagFor(clean);
    if (image) images[clean] = image;
  });
  return images;
};

export default flagImages;
