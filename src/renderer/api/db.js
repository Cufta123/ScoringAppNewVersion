// Thin data-access layer over the preload bridge.
//
// Components and hooks import the API group they need (sailorDB / eventDB /
// heatRaceDB) instead of reaching into `window.electron.sqlite.*` directly.
// This keeps the preload shape referenced in exactly one place, so the IPC
// surface can change without touching every call site, and it makes the data
// dependencies of a module obvious from its imports.
//
// Each method is resolved lazily at call time, so the bridge does not need to
// exist at module-load and tests that assign `window.electron` per test still
// work unchanged.
function makeGroup(groupName) {
  return new Proxy(
    {},
    {
      get(_target, method) {
        return (...args) => window.electron.sqlite[groupName][method](...args);
      },
    },
  );
}

export const sailorDB = makeGroup('sailorDB');
export const eventDB = makeGroup('eventDB');
export const heatRaceDB = makeGroup('heatRaceDB');
