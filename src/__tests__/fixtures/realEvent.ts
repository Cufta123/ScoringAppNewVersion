/**
 * Drive a real event through the real IPC handlers, for tests that run on a
 * real SQLite engine with the real migrations. `call` invokes a registered
 * handler (each test file collects them from its mocked ipcMain).
 */
export type Call = (channel: string, ...args: any[]) => Promise<any>;

export function realEvent(db: any, call: Call) {
  const heatId = (eventId: number, name: string): number =>
    db
      .prepare('SELECT heat_id FROM Heats WHERE event_id = ? AND heat_name = ?')
      .get(eventId, name).heat_id;

  const sailsIn = (id: number): number[] =>
    db
      .prepare(
        'SELECT b.sail_number FROM Heat_Boat hb JOIN Boats b ON b.boat_id = hb.boat_id WHERE hb.heat_id = ? ORDER BY b.sail_number',
      )
      .all(id)
      .map((row: { sail_number: number }) => row.sail_number);

  return {
    heatId,
    sailsIn,

    async createEvent(name: string): Promise<number> {
      const result = await call(
        'insertEvent',
        name,
        'Split',
        '2026-05-01',
        '2026-05-03',
      );
      return Number(result.lastInsertRowid);
    },

    /** Create boats CRO <sail> (boat_id follows insertion) and enter them. */
    async enterBoats(eventId: number, sails: number[]) {
      for (const sail of sails) {
        const boatId = Number(
          db
            .prepare(
              "INSERT INTO Boats (sail_number, country, model) VALUES (?, 'CRO', 'IOM')",
            )
            .run(sail).lastInsertRowid,
        );
        // eslint-disable-next-line no-await-in-loop
        await call('associateBoatWithEvent', boatId, eventId);
      }
    },

    /** Score a heat; boats finish in sail-number order unless `reversed`. */
    async scoreHeat(eventId: number, name: string, reversed = false) {
      const id = heatId(eventId, name);
      const sails = sailsIn(id);
      if (reversed) sails.reverse();
      const result = await call('submitHeatRaceScoresAtomic', {
        heat_id: id,
        placeNumbers: sails.map((sail, index) => ({
          boatNumber: sail,
          place: index + 1,
          status: 'FINISHED',
        })),
      });
      if (!result?.ok) throw new Error(`Scoring ${name} failed`);
      return result.raceId as number;
    },
  };
}
