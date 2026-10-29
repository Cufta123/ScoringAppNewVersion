/** SHRS 3.2: a heat should race once per round before boats are redistributed. */
export const raceAgainWarning = (heatName: string, racesDone: number): string =>
  `Warning: "${heatName}" has already completed Race ${racesDone}.\n\n` +
  `According to SHRS 3.2 boats should be redistributed before racing again.\n\n` +
  `Press OK to score Race ${racesDone + 1} anyway, or Cancel to go back and use "Create New Heats from Leaderboard" first.`;

export const unmatchedSailsMessage = (
  heatName: string,
  unmatched: ReadonlyArray<string | number>,
): string =>
  `Cannot save scores because these sail numbers are not in ${heatName}: ${unmatched.join(', ')}.\n\n` +
  'What to do:\n' +
  '1) Go back to heats and re-open scoring for this heat.\n' +
  '2) Check that each sail number belongs to the selected heat.\n' +
  '3) Re-enter the race results and submit again.';

export const laterRoundBlocksUndoMessage = (laterRounds: string[]): string =>
  `The next round (${laterRounds.join(', ')}) was already built from this round's results, so this race can't be undone on its own.\n\nUse "Undo Heat Redistribution" first, then undo the race.`;
