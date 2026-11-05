// `npm run test:full` (jest's setupFiles): the template's whole-app test
// needs the production build that `npm run build` writes to release/app/dist.
import path from 'path';
import fs from 'fs';

const dist = path.join(__dirname, '..', 'release', 'app', 'dist');

if (!fs.existsSync(path.join(dist, 'main', 'main.js'))) {
  throw new Error(
    'The main process is not built yet. Build it by running "npm run build"',
  );
}

if (!fs.existsSync(path.join(dist, 'renderer', 'index.html'))) {
  throw new Error(
    'The renderer process is not built yet. Build it by running "npm run build"',
  );
}
