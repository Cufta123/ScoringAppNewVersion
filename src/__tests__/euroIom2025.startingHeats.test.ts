/**
 * Replay of the published QRace 1 draw for the IOM European Championship 2025
 * (`e2e/fixtures/The International One Metre Class European Championship
 * 2025_heat_1.json`) through the app's own initial-heat seeding.
 *
 * The sheet is the starting list the race office actually posted: 98 entries
 * split A/B/C/D/E as 20/20/20/19/19, each heat printed in seeding order. That
 * makes it a direct check on `compareByCountryThenSail` (SHRS 3.1(iv) / rule 3
 * preamble: national letter alphabetically, then sail number numerically) and
 * on `assignBoatsToInitialHeatsSerpentine` (SHRS 3.1 serpentine spread).
 *
 * As everywhere in this replay, a difference is characterised and explained,
 * not corrected in `src/`.
 */
import {
  assignBoatsToInitialHeatsSerpentine,
  compareByCountryThenSail,
} from '../main/functions/creatingNewHeatsUtls';
import {
  publishedResults,
  startingHeats,
  StartingHeatEntry,
} from './fixtures/euroIom2025';

const heatsFixture = startingHeats();
const published = publishedResults();

/** The 98 entries in the order the app would seed them (SHRS 3.1(iv)). */
const seedingOrder = (): StartingHeatEntry[] =>
  heatsFixture.heats
    .flatMap((heat) => heat.entries)
    .sort(compareByCountryThenSail);

const identity = (entry: { country: string; sail_number: string }) =>
  `${entry.country.toUpperCase()} ${Number(entry.sail_number)}`;

describe('published starting heats — structure', () => {
  it('is the same 98-boat entry list as the result sheet', () => {
    expect(heatsFixture.entry_count).toBe(98);
    expect(heatsFixture.heats).toHaveLength(5);

    // Matched on national letter + sail number rather than name: the two
    // documents spell one competitor differently — "Abdila Darren" on the
    // starting list, "Abdilla Darren" on the result sheet. Sail numbers are
    // unique within a national letter, so they identify a boat unambiguously.
    const fromHeats = heatsFixture.heats
      .flatMap((heat) => heat.entries)
      .map(identity)
      .sort();
    const fromResults = published.results.map(identity).sort();
    expect(fromHeats).toEqual(fromResults);
  });

  it('splits the fleet 20/20/20/19/19 across heats A–E', () => {
    expect(heatsFixture.heats.map((heat) => heat.heat_letter)).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
    ]);
    expect(heatsFixture.heats.map((heat) => heat.entries.length)).toEqual([
      20, 20, 20, 19, 19,
    ]);
    heatsFixture.heats.forEach((heat) => {
      expect(heat.entries.map((entry) => entry.position)).toEqual(
        heat.entries.map((_entry, index) => index + 1),
      );
      expect(heat.entry_count).toBe(heat.entries.length);
    });
  });
});

describe('SHRS 3.1 seeding order', () => {
  it('lists every published heat in the order compareByCountryThenSail produces', () => {
    // This is the app's comparator applied to the published heat as printed:
    // if the race office ordered the boats any other way, sorting would move
    // something. Nothing moves — national letter, then sail number, with "9"
    // ahead of "10" (compareSailNumbers is numeric-aware).
    heatsFixture.heats.forEach((heat) => {
      const printed = heat.entries.map(identity);
      const sorted = [...heat.entries]
        .sort(compareByCountryThenSail)
        .map(identity);
      expect(sorted).toEqual(printed);
    });
  });
});

describe('SHRS 3.1 serpentine draw', () => {
  const letters = ['A', 'B', 'C', 'D', 'E'];

  /** Heat letter per boat, in seeding order, as the app would assign them. */
  const appDraw = (): string[] =>
    assignBoatsToInitialHeatsSerpentine(98, 5).map((index) => letters[index]);

  /** Heat letter per boat, in seeding order, as the sheet printed them. */
  const publishedDraw = (): string[] => {
    const byBoat = new Map<string, string>();
    heatsFixture.heats.forEach((heat) =>
      heat.entries.forEach((entry) =>
        byBoat.set(identity(entry), heat.heat_letter),
      ),
    );
    return seedingOrder().map((entry) => byBoat.get(identity(entry)) as string);
  };

  it('reproduces the published draw for the first 95 of 98 seeds', () => {
    const app = appDraw();
    const sheet = publishedDraw();

    // Both run the same serpentine — A,B,C,D,E,E,D,C,B,A repeating, the
    // boundary heat taken twice so adjacent-strength boats spread evenly.
    expect(sheet.slice(0, 90).join('')).toBe('ABCDEEDCBA'.repeat(9));
    expect(app.slice(0, 95)).toEqual(sheet.slice(0, 95));
  });

  it('follows the SHRS 3.1(i) order into the partial last pass, where the sheet does not', () => {
    const app = appDraw();
    const sheet = publishedDraw();
    const seeds = seedingOrder();

    // SHRS 3.1(i) states the Race 1 draw as a literal order: "boats will be
    // assigned to heats starting from the top ranked boat in the order
    // 1, 2, 3, 4, 5, 5, 4, 3, 2, 1". With 98 boats that order is walked nine
    // times over (90 boats) and then runs out eight boats into the tenth pass.
    //
    //   seeds 91..98   rule / app   A B C D E E D C
    //                  published    A B C D E A B C
    //
    // The app truncates the written order — the only thing 3.1(i) can mean.
    // The published draw instead restarts at heat 1 after reaching heat 5,
    // which is not the stated order. So the app is following the rule here and
    // the sheet is the outlier; the difference is recorded, not corrected.
    //
    // Nothing else in SHRS chooses between them: 2.2 asks only that heats be
    // "as equal as possible" and both draws give 20/20/20/19/19, 2.3's cap of
    // 20 is met by both, and 4.1's "Silver no larger than Gold" governs the
    // FINAL fleets, not qualifying heats. They differ only in which heats hold
    // the three larger ones:
    //
    //   published  A 20  B 20  C 20  D 19  E 19
    //   app        A 19  B 19  C 20  D 20  E 20
    //
    // Two boats land in a different heat as a result, both at the very end of
    // the seeding list (USA, the last national letter).
    expect(app.slice(90)).toEqual(['A', 'B', 'C', 'D', 'E', 'E', 'D', 'C']);
    expect(sheet.slice(90)).toEqual(['A', 'B', 'C', 'D', 'E', 'A', 'B', 'C']);

    const moved = seeds
      .map((entry, index) => ({ entry, index }))
      .filter(({ index }) => app[index] !== sheet[index])
      .map(({ entry, index }) => ({
        name: entry.name,
        seed: index + 1,
        published: sheet[index],
        app: app[index],
      }));
    expect(moved).toEqual([
      { name: 'Golison Mark', seed: 96, published: 'A', app: 'E' },
      { name: 'Boell Gary', seed: 97, published: 'B', app: 'D' },
    ]);

    const sizeOf = (draw: string[]) =>
      letters.map((letter) => draw.filter((entry) => entry === letter).length);
    expect(sizeOf(sheet)).toEqual([20, 20, 20, 19, 19]);
    expect(sizeOf(app)).toEqual([19, 19, 20, 20, 20]);
  });
});
