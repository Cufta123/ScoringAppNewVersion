import heats from '../fixtures/regatta/rogoznicaStartingHeats.json';
import { compareByCountryThenSail, assignBoatsToInitialHeatsSerpentine } from '../src/main/functions/creatingNewHeatsUtls';

const published = (heats as any).heats;
const all = published.flatMap((h: any) => h.entries.map((e: any) => ({
  country: e.country, sail_number: e.sail_number, name: e.name,
})));
console.log('entries', all.length, 'heats', published.length);
published.forEach((h: any) => console.log(' ', h.heat, h.entry_count));

const seeded = [...all].sort(compareByCountryThenSail);
const idx = assignBoatsToInitialHeatsSerpentine(seeded.length, published.length);
const computed: string[][] = published.map(() => []);
seeded.forEach((b, i) => computed[idx[i]].push(String(Number(b.sail_number))));

published.forEach((h: any, i: number) => {
  const pub = h.entries.map((e: any) => String(Number(e.sail_number))).sort();
  const got = [...computed[i]].sort();
  const same = JSON.stringify(pub) === JSON.stringify(got);
  console.log(h.heat, 'published', pub.length, 'computed', got.length, same ? 'MATCH' : 'DIFF');
  if (!same) {
    console.log('   only in published:', pub.filter((s: string) => !got.includes(s)).join(' '));
    console.log('   only in computed :', got.filter((s: string) => !pub.includes(s)).join(' '));
  }
});
