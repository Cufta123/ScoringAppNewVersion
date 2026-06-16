// Single source of truth for subgroup ↔ category mapping.
// Used by the sailor entry form, the sailor list, the printouts and the CSV
// import so they all speak the same vocabulary (M / GM / L / U25 / U16) instead
// of drifting between subgroup codes and raw category names.

export interface SubgroupOption {
  value: string;
  label: string;
  categoryId: number;
  categoryName: string;
}

export const SUBGROUP_OPTIONS: SubgroupOption[] = [
  {
    value: 'M',
    label: 'M — Masters (Veteran)',
    categoryId: 4,
    categoryName: 'VETERAN',
  },
  {
    value: 'GM',
    label: 'GM — Grand Masters (Master)',
    categoryId: 5,
    categoryName: 'MASTER',
  },
  {
    value: 'L',
    label: 'L — Open (Senior)',
    categoryId: 3,
    categoryName: 'SENIOR',
  },
  {
    value: 'U25',
    label: 'U25 — Under 25 (Junior)',
    categoryId: 2,
    categoryName: 'JUNIOR',
  },
  {
    value: 'U16',
    label: 'U16 — Under 16 (Kadet)',
    categoryId: 1,
    categoryName: 'KADET',
  },
];

const byCategoryName = new Map<string, string>(
  SUBGROUP_OPTIONS.map((option): [string, string] => [
    option.categoryName.toUpperCase(),
    option.value,
  ]),
);

const byCode = new Map<string, SubgroupOption>(
  SUBGROUP_OPTIONS.map((option): [string, SubgroupOption] => [
    option.value.toUpperCase(),
    option,
  ]),
);

// Returns the subgroup code (e.g. "M") for a category name (e.g. "VETERAN"),
// or null when the input is not a known category name.
export function categoryNameToSubgroup(
  categoryName: string | null | undefined,
): string | null {
  if (!categoryName) return null;
  return byCategoryName.get(String(categoryName).trim().toUpperCase()) || null;
}

// Returns the category name (e.g. "VETERAN") for a subgroup code (e.g. "M"),
// or null when the input is not a known subgroup code.
export function subgroupToCategoryName(
  code: string | null | undefined,
): string | null {
  if (!code) return null;
  const option = byCode.get(String(code).trim().toUpperCase());
  return option ? option.categoryName : null;
}

// Display helper: prefer a subgroup code, accepting either a code or a category
// name as input, and falling back to the raw value when nothing matches.
export function toSubgroupLabel(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (byCode.has(raw.toUpperCase())) return raw.toUpperCase();
  return categoryNameToSubgroup(raw) || raw;
}
