import heats from '../fixtures/regatta/rogoznicaStartingHeats.json';
import { compareByCountryThenSail, assignBoatsToInitialHeatsSerpentine } from '../src/main/functions/creatingNewHeatsUtls';

const published = (heats as any).heats;
const all = published.flatMap((h: any) => h.entries.map((e: any) => ({
  country: e.country, sail_number: e.sail_number, name: e.name,
})));
const seeded = [...all].sort(compareByCountryThenSail);
const heatOf = new Map<string, number>();
published.forEach((h: any, i: number) =>
  h.entries.forEach((e: any) => heatOf.set(String(Number(e.sail_number)), i)));

console.log('seeded order -> published heat index:');
console.log(seeded.map((b: any) => heatOf.get(String(Number(b.sail_number)))).join(''));
console.log('serpentine   :', assignBoatsToInitialHeatsSerpentine(77, 4).join(''));
const rr = Array.from({length:77},(_,i)=>i%4);
console.log('round-robin  :', rr.join(''));
console.log();
console.log('first 12 seeded:', seeded.slice(0,12).map((b:any)=>`${b.country}${b.sail_number}`).join(' '));
// country spread per published heat
published.forEach((h:any)=>{
  const cs: Record<string,number> = {};
  h.entries.forEach((e:any)=>{cs[e.country]=(cs[e.country]||0)+1;});
  console.log(h.heat, JSON.stringify(cs));
});
