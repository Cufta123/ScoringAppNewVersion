/** @jest-environment node */
export {};

// The renderer reaches the main process through a surface declared in
// preload.ts and a set of handlers registered in src/main/ipcHandlers. Those
// live in separate files, and nothing else checks that they agree: a channel
// exposed with no handler, or a handler nothing can reach, only shows up at
// runtime as a dead button. Every other suite mocks `window.electron`, so a
// broken preload would pass them all.

const exposed: Record<string, any> = {};
const registered = new Set<string>();

jest.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, value: any) => {
      exposed[key] = value;
    },
  },
  ipcRenderer: {
    invoke: jest.fn(async (channel: string) => `invoked:${channel}`),
    send: jest.fn(),
    on: jest.fn(),
    once: jest.fn(),
    removeListener: jest.fn(),
  },
  ipcMain: {
    handle: (channel: string) => registered.add(channel),
    on: jest.fn(),
  },
  dialog: {},
}));

jest.mock('../../public/Database/DBManager', () => ({
  db: { prepare: jest.fn(), exec: jest.fn(), transaction: jest.fn() },
}));

describe('preload / handler contract', () => {
  beforeAll(() => {
    require('../main/preload');
    require('../main/ipcHandlers/SailorHandler');
    require('../main/ipcHandlers/EventHandler');
    require('../main/ipcHandlers/HeatRaceHandler');
    require('../main/ipcHandlers/ExportHandler');
  });

  const exposedChannels = () => {
    const names = new Set<string>();
    Object.values(exposed.electron.sqlite).forEach((api: any) =>
      Object.keys(api).forEach((name) => names.add(name)),
    );
    return names;
  };

  it('exposes the four api groups', () => {
    expect(Object.keys(exposed.electron.sqlite).sort()).toEqual([
      'eventDB',
      'exportDB',
      'heatRaceDB',
      'sailorDB',
    ]);
  });

  it('exposes every channel as a callable function', () => {
    Object.values(exposed.electron.sqlite).forEach((api: any) =>
      Object.values(api).forEach((fn) => expect(typeof fn).toBe('function')),
    );
  });

  it('exposes exactly the channels the main process registers', () => {
    const names = exposedChannels();
    const missingHandler = [...names].filter((c) => !registered.has(c));
    const unreachable = [...registered].filter((c) => !names.has(c));
    expect({ missingHandler, unreachable }).toEqual({
      missingHandler: [],
      unreachable: [],
    });
  });

  it('forwards a call to ipcRenderer.invoke', async () => {
    await expect(
      exposed.electron.sqlite.heatRaceDB.readAllHeats(7),
    ).resolves.toBe('invoked:readAllHeats');
  });

  it('converts a resolved false into a thrown error', async () => {
    const { ipcRenderer } = require('electron');
    ipcRenderer.invoke.mockResolvedValueOnce(false);
    await expect(
      exposed.electron.sqlite.eventDB.deleteEvent(1),
    ).rejects.toThrow(/Operation failed/);
  });

  it('keeps the importSailors fallback instead of throwing', async () => {
    // Callers render the returned summary object even on failure.
    const { ipcRenderer } = require('electron');
    ipcRenderer.invoke.mockRejectedValueOnce(new Error('boom'));
    await expect(
      exposed.electron.sqlite.sailorDB.importSailors([]),
    ).resolves.toEqual({ imported: 0, skipped: 0, errors: ['boom'] });
  });
});
