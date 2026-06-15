import { heatRaceDB } from '../api/db';

// Single source of truth for "has any race been scored in this event?".
//
// Previously EventPage and SailorForm each carried their own copy of this
// heats -> races round trip to decide whether boats/sailors can still be
// added. Centralizing it keeps the behaviour identical everywhere and avoids
// the two implementations drifting apart.
//
// (HeatComponent deliberately does NOT use this: it already loads per-heat
// race counts for display and derives the same flag from that data, so calling
// here would just duplicate a fetch it has already made.)
export const checkRaceHappened = async (eventId: number): Promise<boolean> => {
  const heats = await heatRaceDB.readAllHeats(eventId);
  const races = await Promise.all(
    heats.map((heat) => heatRaceDB.readAllRaces(heat.heat_id)),
  );
  return races.some((raceArray) => raceArray.length > 0);
};

export default checkRaceHappened;
