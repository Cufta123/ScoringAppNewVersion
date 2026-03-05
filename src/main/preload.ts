/* eslint-disable no-console */
/* eslint-disable camelcase */
// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

export type Channels =
  | 'ipc-example'
  | 'readAllSailors'
  | 'insertSailor'
  | 'readAllCategories'
  | 'readAllClubs'
  | 'insertClub'
  | 'insertBoat'
  | 'readAllBoats'
  | 'readAllEvents'
  | 'insertEvent'
  | 'associateBoatWithEvent'
  | 'readBoatsByEvent'
  | 'removeBoatFromEvent'
  | 'readAllHeats'
  | 'insertHeat'
  | 'insertHeatBoat'
  | 'readAllRaces'
  | 'insertRace'
  | 'readAllScores'
  | 'insertScore'
  | 'updateScore'
  | 'deleteScore'
  | 'deleteHeatsByEvent'
  | 'recreateHeats'
  | 'updateEventLeaderboard'
  | 'updateGlobalLeaderboard'
  | 'createNewHeatsBasedOnLeaderboard'
  | 'undoLastScoredRaceForHeat'
  | 'undoLastScoredRace'
  | 'undoLatestHeatRedistribution'
  | 'transferBoatBetweenHeats'
  | 'readLeaderboard'
  | 'readGlobalLeaderboard'
  | 'updateFinalLeaderboard'
  | 'readFinalLeaderboard'
  | 'readOverallLeaderboard'
  | 'lockEvent'
  | 'unlockEvent'
  | 'updateRaceResult'
  | 'getMaxHeatSize'
  | 'importSailors';

const electronHandler = {
  ipcRenderer: {
    sendMessage(channel: Channels, ...args: unknown[]) {
      ipcRenderer.send(channel, ...args);
    },
    on(channel: Channels, func: (...args: unknown[]) => void) {
      const subscription = (_event: IpcRendererEvent, ...args: unknown[]) =>
        func(...args);
      ipcRenderer.on(channel, subscription);

      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    },
    once(channel: Channels, func: (...args: unknown[]) => void) {
      ipcRenderer.once(channel, (_event, ...args) => func(...args));
    },
  },
  sqlite: {
    sailorDB: {
      async readAllSailors() {
        try {
          return await ipcRenderer.invoke('readAllSailors');
        } catch (error) {
          console.error('Error invoking readAllSailors IPC:', error);
          return false;
        }
      },
      async updateSailor(
        sailor_id: string,
        name: string,
        surname: string,
        birthday: string,
        category_id: string,
        club_id: string,
      ) {
        try {
          return await ipcRenderer.invoke(
            'updateSailor',
            sailor_id,
            name,
            surname,
            birthday,
            category_id,
            club_id,
          );
        } catch (error) {
          console.error('Error invoking updateSailor IPC:', error);
          return false;
        }
      },
      async insertSailor(
        name: string,
        surname: string,
        birthday: string,
        category_id: string,
        club_id: string,
      ) {
        try {
          return await ipcRenderer.invoke(
            'insertSailor',
            name,
            surname,
            birthday,
            category_id,
            club_id,
          );
        } catch (error) {
          console.error('Error invoking insertSailor IPC:', error);
          return false;
        }
      },
      async insertClub(club_name: string, country: string) {
        try {
          return await ipcRenderer.invoke('insertClub', club_name, country);
        } catch (error) {
          console.error('Error invoking insertClub IPC:', error);
          return false;
        }
      },
      async insertBoat(
        sail_number: string,
        country: string,
        model: string,
        sailor_id: string,
      ) {
        try {
          return await ipcRenderer.invoke(
            'insertBoat',
            sail_number,
            country,
            model,
            sailor_id,
          );
        } catch (error) {
          if (error === 'SQLITE_CONSTRAINT') {
            console.error('Error: The sail number already exists.');
            // eslint-disable-next-line no-alert
            alert(
              'The sail number already exists. Please use a different sail number.',
            );
          } else {
            console.error('Error invoking insertBoat IPC:', error);
          }
          return false;
        }
      },
      async readAllCategories() {
        try {
          return await ipcRenderer.invoke('readAllCategories');
        } catch (error) {
          console.error('Error invoking readAllCategories IPC:', error);
          return false;
        }
      },
      async readAllClubs() {
        try {
          return await ipcRenderer.invoke('readAllClubs');
        } catch (error) {
          console.error('Error invoking readAllClubs IPC:', error);
          return false;
        }
      },
      async readAllBoats() {
        try {
          return await ipcRenderer.invoke('readAllBoats');
        } catch (error) {
          console.error('Error invoking readAllBoats IPC:', error);
          return false;
        }
      },
      async importSailors(rows: unknown[]) {
        try {
          return await ipcRenderer.invoke('importSailors', rows);
        } catch (error) {
          console.error('Error invoking importSailors IPC:', error);
          return { imported: 0, skipped: 0, errors: [(error as Error).message] };
        }
      },
    },
    eventDB: {
      async readAllEvents() {
        try {
          return await ipcRenderer.invoke('readAllEvents');
        } catch (error) {
          console.error('Error invoking readAllEvents IPC: ', error);
          return false;
        }
      },
      async insertEvent(
        event_name: string,
        event_location: string,
        start_date: string,
        end_date: string,
      ) {
        try {
          return await ipcRenderer.invoke(
            'insertEvent',
            event_name,
            event_location,
            start_date,
            end_date,
          );
        } catch (error) {
          console.error('Error invoking insertEvent IPC:', error);
          return false;
        }
      },
      async associateBoatWithEvent(boat_id: string, event_id: string) {
        try {
          return await ipcRenderer.invoke(
            'associateBoatWithEvent',
            boat_id,
            event_id,
          );
        } catch (error) {
          console.error('Error invoking associateBoatWithEvent IPC:', error);
          return false;
        }
      },
      async readBoatsByEvent(event_id: string) {
        try {
          return await ipcRenderer.invoke('readBoatsByEvent', event_id);
        } catch (error) {
          console.error('Error invoking readBoatsByEvent IPC:', error);
          return false;
        }
      },
      async removeBoatFromEvent(boat_id: string, event_id: string) {
        try {
          return await ipcRenderer.invoke(
            'removeBoatFromEvent',
            boat_id,
            event_id,
          );
        } catch (error) {
          console.error('Error invoking removeBoatFromEvent IPC:', error);
          return false;
        }
      },
      async lockEvent(event_id: string) {
        try {
          return await ipcRenderer.invoke('lockEvent', event_id);
        } catch (error) {
          console.error('Error invoking lockEvent IPC:', error);
          return false;
        }
      },
      async unlockEvent(event_id: string) {
        try {
          return await ipcRenderer.invoke('unlockEvent', event_id);
        } catch (error) {
          console.error('Error invoking unlockEvent IPC:', error);
          return false;
        }
      },
    },
    heatRaceDB: {
      async readAllHeats(event_id: string) {
        try {
          return await ipcRenderer.invoke('readAllHeats', event_id);
        } catch (error) {
          console.error('Error invoking readAllHeats IPC:', error);
          return false;
        }
      },
      async insertHeat(event_id: string, heat_name: string, heat_type: string) {
        try {
          return await ipcRenderer.invoke(
            'insertHeat',
            event_id,
            heat_name,
            heat_type,
          );
        } catch (error) {
          console.error('Error invoking insertHeat IPC:', error);
          return false;
        }
      },
      async deleteHeatsByEvent(event_id: string) {
        try {
          return await ipcRenderer.invoke('deleteHeatsByEvent', event_id);
        } catch (error) {
          console.error('Error invoking deleteHeatsByEvent IPC:', error);
          return false;
        }
      },
      async insertHeatBoat(heat_id: string, boat_id: string) {
        try {
          return await ipcRenderer.invoke('insertHeatBoat', heat_id, boat_id);
        } catch (error) {
          console.error('Error invoking insertHeatBoat IPC:', error);
          return false;
        }
      },
      async readBoatsByHeat(heat_id: string) {
        try {
          return await ipcRenderer.invoke('readBoatsByHeat', heat_id);
        } catch (error) {
          console.error('Error invoking readBoatsByHeat IPC:', error);
          return false;
        }
      },
      async readAllRaces(heat_id: string) {
        try {
          return await ipcRenderer.invoke('readAllRaces', heat_id);
        } catch (error) {
          console.error('Error invoking readAllRaces IPC:', error);
          return false;
        }
      },
      async insertRace(heat_id: string, race_number: number) {
        try {
          return await ipcRenderer.invoke('insertRace', heat_id, race_number);
        } catch (error) {
          throw error;
        }
      },
      async readAllScores(race_id: string) {
        try {
          return await ipcRenderer.invoke('readAllScores', race_id);
        } catch (error) {
          console.error('Error invoking readAllScores IPC:', error);
          return false;
        }
      },
      async insertScore(
        race_id: string,
        boat_id: string,
        position: string,
        points: number,
        status: string,
      ) {
        try {
          return await ipcRenderer.invoke(
            'insertScore',
            race_id,
            boat_id,
            position,
            points,
            status,
          );
        } catch (error) {
          throw error;
        }
      },
      async updateScore(
        score_id: string,
        position: string,
        points: number,
        status: string,
      ) {
        try {
          return await ipcRenderer.invoke(
            'updateScore',
            score_id,
            position,
            points,
            status,
          );
        } catch (error) {
          console.error('Error invoking updateScore IPC:', error);
          return false;
        }
      },
      async deleteScore(score_id: string) {
        try {
          return await ipcRenderer.invoke('deleteScore', score_id);
        } catch (error) {
          console.error('Error invoking deleteScore IPC:', error);
          return false;
        }
      },
      async recreateHeats(event_id: string, numHeats: number) {
        try {
          return await ipcRenderer.invoke('recreateHeats', event_id, numHeats);
        } catch (error) {
          console.error('Error invoking recreateHeats IPC:', error);
          return false;
        }
      },
      async updateEventLeaderboard(event_id: string) {
        try {
          return await ipcRenderer.invoke('updateEventLeaderboard', event_id);
        } catch (error) {
          console.error('Error invoking updateEventLeaderboard IPC:', error);
          return false;
        }
      },
      async updateGlobalLeaderboard(event_id: string) {
        try {
          return await ipcRenderer.invoke('updateGlobalLeaderboard', event_id);
        } catch (error) {
          console.error('Error invoking updateGlobalLeaderboard IPC:', error);
          return false;
        }
      },
      createNewHeatsBasedOnLeaderboard: async (event_id: string) => {
        try {
          return await ipcRenderer.invoke(
            'createNewHeatsBasedOnLeaderboard',
            event_id,
          );
        } catch (error) {
          throw error;
        }
      },
      async undoLastScoredRaceForHeat(heat_id: number) {
        try {
          return await ipcRenderer.invoke('undoLastScoredRaceForHeat', heat_id);
        } catch (error) {
          throw error;
        }
      },
      async undoLastScoredRace(event_id: string) {
        try {
          return await ipcRenderer.invoke('undoLastScoredRace', event_id);
        } catch (error) {
          throw error;
        }
      },
      async undoLatestHeatRedistribution(event_id: string) {
        try {
          return await ipcRenderer.invoke(
            'undoLatestHeatRedistribution',
            event_id,
          );
        } catch (error) {
          throw error;
        }
      },
      async transferBoatBetweenHeats(
        from_heat_id: string,
        to_heat_id: string,
        boat_id: string,
      ) {
        try {
          return await ipcRenderer.invoke(
            'transferBoatBetweenHeats',
            from_heat_id,
            to_heat_id,
            boat_id,
          );
        } catch (error) {
          console.error('Error invoking transferBoatBetweenHeats IPC:', error);
          return false;
        }
      },
      async readLeaderboard(event_id: string) {
        try {
          return await ipcRenderer.invoke('readLeaderboard', event_id);
        } catch (error) {
          console.error('Error invoking readLeaderboard IPC:', error);
          return false;
        }
      },
      async readGlobalLeaderboard() {
        try {
          return await ipcRenderer.invoke('readGlobalLeaderboard');
        } catch (error) {
          console.error('Error invoking readGlobalLeaderboard IPC:', error);
          return false;
        }
      },
      async updateFinalLeaderboard(event_id: string) {
        try {
          return await ipcRenderer.invoke('updateFinalLeaderboard', event_id);
        } catch (error) {
          console.error('Error invoking updateFinalLeaderboard IPC:', error);
          return false;
        }
      },
      async updateRaceResult(
        event_id: string,
        race_id: string,
        boat_id: string,
        new_position: string,
        shift_positions: boolean,
        new_status: string,
      ) {
        try {
          return await ipcRenderer.invoke(
            'updateRaceResult',
            event_id,
            race_id,
            boat_id,
            new_position,
            shift_positions,
            new_status,
          );
        } catch (error) {
          console.error('Error invoking updateRaceResult IPC:', error);
          return false;
        }
      },
      async readFinalLeaderboard(event_id: string) {
        try {
          return await ipcRenderer.invoke('readFinalLeaderboard', event_id);
        } catch (error) {
          console.error('Error invoking readFinalLeaderboard IPC:', error);
          return false;
        }
      },
      async readOverallLeaderboard(event_id: string) {
        try {
          return await ipcRenderer.invoke('readOverallLeaderboard', event_id);
        } catch (error) {
          console.error('Error invoking readOverallLeaderboard IPC:', error);
          return false;
        }
      },
      async getMaxHeatSize(event_id: string, heat_type?: string) {
        try {
          return await ipcRenderer.invoke(
            'getMaxHeatSize',
            event_id,
            heat_type,
          );
        } catch (error) {
          console.error('Error invoking getMaxHeatSize IPC:', error);
          return 0;
        }
      },
    },
  },
};

contextBridge.exposeInMainWorld('electron', electronHandler);

export type ElectronHandler = typeof electronHandler;
