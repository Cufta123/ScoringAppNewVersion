const { contextBridge, ipcRenderer } = require('electron');
const { read } = require('fs');
const sailorDB = require('../../public/Database/SailorsManager');
const eventDB = require('../../public/Database/EventManager');
const heatRaceDB = require('../../public/Database/HeatRaceManager');

const electronHandler = {
  ipcRenderer: {
    sendMessage(channel, ...args) {
      ipcRenderer.send(channel, ...args);
    },
    on(channel, func) {
      const subscription = (_event, ...args) => func(...args);
      ipcRenderer.on(channel, subscription);
      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    },
    once(channel, func) {
      ipcRenderer.once(channel, (_event, ...args) => func(...args));
    },
  },
  sailorDB: {
    readAllSailors: sailorDB.readAllSailors,
    insertSailor: sailorDB.insertSailor,
    insertClub: sailorDB.insertClub,
    insertBoat: sailorDB.insertBoat,
    readAllCategories: sailorDB.readAllCategories,
    readAllClubs: sailorDB.readAllClubs,
    readAllBoats: sailorDB.readAllBoats,
  },
  eventDB: {
    readAllEvents: eventDB.readAllEvents,
    insertEvent: eventDB.insertEvent,
    associateBoatWithEvent: eventDB.associateBoatWithEvent,
    readBoatsByEvent: eventDB.readBoatsByEvent,
    removeBoatFromEvent: eventDB.removeBoatFromEvent,
    lockEvent: eventDB.lockEvent,
    unlockEvent: eventDB.unlockEvent,
  },
  heatRaceDB: {
    readAllHeats: heatRaceDB.readAllHeats,
    insertHeat: heatRaceDB.insertHeat,
    insertHeatBoat: heatRaceDB.insertHeatBoat,
    readBoatsByHeat: heatRaceDB.readBoatsByHeat,
    readAllRaces: heatRaceDB.readAllRaces,
    insertRace: heatRaceDB.insertRace,
    readAllScores: heatRaceDB.readAllScores,
    insertScore: heatRaceDB.insertScore,
    updateScore: heatRaceDB.updateScore,
    deleteScore: heatRaceDB.deleteScore,
    deleteHeatsByEvent: heatRaceDB.deleteHeatsByEvent,
    transferBoatBetweenHeats: heatRaceDB.transferBoatBetweenHeats,
    updateEventLeaderboard: heatRaceDB.updateEventLeaderboard,
    updateGlobalLeaderboard: heatRaceDB.updateGlobalLeaderboard,
    readLeaderboard: heatRaceDB.readLeaderboard,
    readGlobalLeaderboard: heatRaceDB.readGlobalLeaderboard,
    updateFinalLeaderboard: heatRaceDB.updateFinalLeaderboard,
    readFinalLeaderboard: heatRaceDB.readFinalLeaderboard,
    updateRaceResult: heatRaceDB.updateRaceResult,
  },
};

contextBridge.exposeInMainWorld('electron', electronHandler);
