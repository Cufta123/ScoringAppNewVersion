/** The app imports the scoring library by its package name. */
import { FORMAT_VERSION, replay } from 'regatta-core';

it('resolves regatta-core', () => {
  expect(FORMAT_VERSION).toBe(1);
  expect(replay([]).ok).toBe(true);
});
