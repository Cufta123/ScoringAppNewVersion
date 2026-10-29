interface NamedRow {
  name?: string | null;
  surname?: string | null;
}

/**
 * A sailor's name as shown on screen and in exports. Boat reads join the
 * sailor with a LEFT JOIN, so either part can be null (a boat entered without
 * a sailor): a missing part is left out, never printed as "null" or
 * "undefined", and a boat with neither gives ''.
 */
export function sailorFullName(row: NamedRow | null | undefined): string {
  return [row?.name, row?.surname]
    .map((part) => String(part ?? '').trim())
    .filter((part) => part !== '')
    .join(' ');
}

export default sailorFullName;
