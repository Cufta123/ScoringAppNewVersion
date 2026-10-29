import { boatsByEntryName, normalizeEntryKey } from '../../shared/boatKeys';
import type { SailNumber } from './finishOrder';

/**
 * Turn what the scorer typed ("101 205, ITA 12") into one token per boat.
 * "ITA 12" may be typed with a space, so national letters join the number
 * that follows them.
 */
export function tokenizeSailInput(input: string): string[] {
  const tokens: string[] = [];
  input
    .split(/[\s,;]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .forEach((token) => {
      const previous = tokens[tokens.length - 1];
      if (previous && /^[A-Za-z]{2,3}$/.test(previous) && /^\d/.test(token)) {
        tokens[tokens.length - 1] = `${previous} ${token}`;
      } else {
        tokens.push(token);
      }
    });
  return tokens;
}

export interface TypedBoat {
  boat_id: number | string;
  sail_number: SailNumber;
  country?: string | null;
  /** The name this boat is entered by in her heat (see shared/boatKeys). */
  key: string;
}

export interface TypedSailResolution {
  /** Entry keys of the boats the input names, each once. */
  validKeys: string[];
  /** Numbers that name more than one boat of the heat, with the names that do. */
  ambiguous: Array<{ number: string; options: string[] }>;
  /** Names that are not boats of the heat. */
  unknown: string[];
}

/**
 * Match typed tokens against the boats of one heat. Every name that
 * identifies a boat (her sail number where it is unique, national letters +
 * number always) maps to her entry key; a number two boats share needs the
 * national letters, so it is reported as ambiguous rather than guessed.
 */
export function resolveTypedSails(
  tokens: string[],
  boats: TypedBoat[],
): TypedSailResolution {
  const byName = boatsByEntryName(boats);
  const unique = [...new Set(tokens.map(normalizeEntryKey))];
  const ambiguous: TypedSailResolution['ambiguous'] = [];
  const unknown: string[] = [];
  unique.forEach((name) => {
    if (byName.has(name)) return;
    const sharing = boats.filter(
      (boat) => normalizeEntryKey(boat.sail_number) === name,
    );
    if (sharing.length > 1) {
      ambiguous.push({ number: name, options: sharing.map((b) => b.key) });
    } else {
      unknown.push(name);
    }
  });
  const validKeys = [
    ...new Set(
      unique.filter((name) => byName.has(name)).map((n) => byName.get(n)!.key),
    ),
  ];
  return { validKeys, ambiguous, unknown };
}
