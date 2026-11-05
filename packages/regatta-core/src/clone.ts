/**
 * A deep copy of plain data (everything the library stores is JSON). Not
 * structuredClone, which some environments (jsdom tests) do not have.
 */
export default function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
