import {
  boatMoveQuestion,
  countQualifyingGroups,
  getLastHeats,
  hasFinalHeats,
  hasScoredRace,
  isHeatRecreateRefusal,
  isHeatSetupRefusal,
  parseBoatDrop,
  serializeBoatDrag,
} from '../renderer/utils/heatView';
import type { HeatBoatRow } from '../renderer/types';

const heat = (heat_name: string, heat_type = 'Qualifying', raceNumber = 0) => ({
  heat_name,
  heat_type,
  raceNumber,
});

const boat = {
  boat_id: 7,
  sail_number: 12,
  country: 'CRO',
  model: 'IOM',
  name: 'Ana',
  surname: 'Horvat',
  category_name: null,
} as HeatBoatRow;

describe('countQualifyingGroups', () => {
  it('counts distinct letter groups across rounds', () => {
    const heats = [
      heat('Heat A1'),
      heat('Heat B1'),
      heat('Heat A2'),
      heat('Heat B2'),
      heat('Heat C2'),
    ];
    expect(countQualifyingGroups(heats)).toBe(3);
  });

  it('uses the full base letters and ignores final fleets', () => {
    const heats = [
      heat('Heat AA1'),
      heat('Heat A1'),
      heat('Final Gold', 'Final'),
    ];
    expect(countQualifyingGroups(heats)).toBe(2);
  });

  it('is zero without heats', () => {
    expect(countQualifyingGroups([])).toBe(0);
  });
});

describe('getLastHeats', () => {
  it('keeps only the latest round of each group', () => {
    const heats = [
      heat('Heat A1'),
      heat('Heat B1'),
      heat('Heat A2'),
      heat('Heat B2'),
      heat('Heat A10'),
    ];
    expect(getLastHeats(heats).map((h) => h.heat_name)).toEqual([
      'Heat B2',
      'Heat A10',
    ]);
  });

  it('does not let one group hide another group that is a round behind', () => {
    const heats = [heat('Heat A2'), heat('Heat B1')];
    expect(getLastHeats(heats).map((h) => h.heat_name)).toEqual([
      'Heat A2',
      'Heat B1',
    ]);
  });

  it('returns only the final fleets once the Final Series exists', () => {
    const heats = [
      heat('Heat A1'),
      heat('Heat B1'),
      heat('Final Gold', 'Final'),
      heat('Final Silver', 'Final'),
    ];
    expect(getLastHeats(heats).map((h) => h.heat_name)).toEqual([
      'Final Gold',
      'Final Silver',
    ]);
  });

  it('drops names that are not heats', () => {
    expect(getLastHeats([heat('Nonsense')])).toEqual([]);
  });
});

describe('heat flags', () => {
  it('detects final heats and scored races', () => {
    expect(hasFinalHeats([heat('Heat A1')])).toBe(false);
    expect(hasFinalHeats([heat('Final Gold', 'Final')])).toBe(true);
    expect(hasScoredRace([heat('Heat A1', 'Qualifying', 0)])).toBe(false);
    expect(hasScoredRace([heat('Heat A1', 'Qualifying', 2)])).toBe(true);
  });
});

describe('refusal messages', () => {
  it.each([
    'Cannot create heats: duplicate sail numbers',
    'Heat A would have 21 boats per heat',
    'No boats are registered for this event.',
    'Number of heats must be between 1 and 26.',
  ])('recognises the setup refusal "%s"', (message) => {
    expect(isHeatSetupRefusal(message)).toBe(true);
    expect(isHeatRecreateRefusal(message)).toBe(true);
  });

  it('treats "already scored" as a recreate refusal only', () => {
    const message = 'Cannot recreate: races have already been scored.';
    expect(isHeatSetupRefusal(message)).toBe(false);
    expect(isHeatRecreateRefusal(message)).toBe(true);
  });

  it('leaves technical failures alone', () => {
    expect(isHeatSetupRefusal('disk gone')).toBe(false);
    expect(isHeatRecreateRefusal('disk gone')).toBe(false);
  });
});

describe('boat drag and drop payload', () => {
  it('round-trips a dragged boat', () => {
    expect(parseBoatDrop(serializeBoatDrag(boat, 3))).toEqual({
      boat,
      fromHeatId: 3,
    });
  });

  it.each([
    ['empty', ''],
    ['plain text', 'hello'],
    ['null', 'null'],
    ['no boat', JSON.stringify({ fromHeatId: 1 })],
    ['no source heat', JSON.stringify({ boat })],
  ])('ignores a foreign payload (%s)', (_label, raw) => {
    expect(parseBoatDrop(raw)).toBeNull();
  });

  it('words the move question with the heat names, or a fallback', () => {
    expect(boatMoveQuestion(boat, 'Heat A1', 'Heat B1')).toBe(
      'Move boat 12 (Ana Horvat) from Heat A1 to Heat B1?',
    );
    expect(boatMoveQuestion(boat, undefined, undefined)).toBe(
      'Move boat 12 (Ana Horvat) from its heat to this heat?',
    );
  });
});
