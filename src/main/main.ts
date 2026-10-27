import path from 'path';
import { app, BrowserWindow, shell, dialog, session } from 'electron';
import MenuBuilder from './menu';
import { resolveHtmlPath, resolvePreloadPath } from './util';
import './ipcHandlers/SailorHandler';
import './ipcHandlers/EventHandler';
import './ipcHandlers/HeatRaceHandler';
import handle, { setCallObserver } from './ipcHandlers/handle';
import { autoBackup } from '../../public/Database/DBManager';
import { journalObserver } from './functions/changeJournal';

// Group what each IPC call writes into one entry of the event history.
setCallObserver(journalObserver);

let mainWindow: BrowserWindow | null = null;

if (process.env.NODE_ENV === 'production') {
  // eslint-disable-next-line global-require
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

const isDebug =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

if (isDebug) {
  // eslint-disable-next-line global-require
  require('electron-debug')();
}

// Content-Security-Policy applied to every renderer response. The renderer only
// loads same-origin bundles plus data: URIs (inline flag SVGs, webpack-inlined
// fonts) and uses inline style attributes, so we can keep this tight. In
// development webpack's eval source maps and HMR websocket need looser rules.
const buildContentSecurityPolicy = (): string => {
  const scriptSrc = isDebug
    ? "script-src 'self' 'unsafe-eval'"
    : "script-src 'self'";
  const connectSrc = isDebug
    ? "connect-src 'self' ws://localhost:* http://localhost:*"
    : "connect-src 'self'";

  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    connectSrc,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
};

const applyContentSecurityPolicy = () => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [buildContentSecurityPolicy()],
      },
    });
  });
};

const installExtensions = async () => {
  // eslint-disable-next-line global-require
  const installer = require('electron-devtools-installer');
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
  const extensions = ['REACT_DEVELOPER_TOOLS'];

  return installer
    .default(
      extensions.map((name: string) => installer[name]),
      forceDownload,
    )
    .catch(console.log);
};

const createWindow = async () => {
  if (isDebug) {
    await installExtensions();
  }

  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../assets');

  const getAssetPath = (...paths: string[]): string => {
    return path.join(RESOURCES_PATH, ...paths);
  };

  // Automated GUI tests run the real app in a window that is shown (so the
  // page renders and animates normally) but fully transparent, never takes
  // focus and lets clicks through, so a local test run does not get in the
  // way. A truly hidden window does not run animation frames, and the toasts
  // then never finish leaving and cover the buttons. e2e/helpers.ts sets this.
  const hidden = process.env.SCORING_APP_HIDDEN === '1';
  if (hidden) app.dock?.hide();

  mainWindow = new BrowserWindow({
    show: false,
    width: 1024,
    height: 728,
    icon: getAssetPath('icon.ico'),
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // An unfocused window must still run timers at full speed.
      backgroundThrottling: !hidden,
    },
  });

  mainWindow.loadURL(resolveHtmlPath('index.html'));

  mainWindow.on('ready-to-show', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (hidden) {
      mainWindow.setOpacity(0);
      mainWindow.setIgnoreMouseEvents(true);
      mainWindow.showInactive();
      return;
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      mainWindow.show();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(mainWindow, {
    backupsDir: autoBackup.dir,
  });
  menuBuilder.buildMenu();

  mainWindow.webContents.setWindowOpenHandler((edata) => {
    shell.openExternal(edata.url);
    return { action: 'deny' };
  });
};

// Register the IPC handler for the file dialog
handle('dialog:openFile', async (event, options) => {
  return dialog.showOpenDialog(mainWindow!, options);
});

// Final safety copy of anything scored since the last periodic backup.
app.on('before-quit', () => {
  autoBackup.stop();
  autoBackup.backupIfChanged();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app
  .whenReady()
  .then(() => {
    applyContentSecurityPolicy();
    // Start-up copy, then rolling copies while results are being entered.
    autoBackup.backupNow();
    autoBackup.start();
    createWindow();
    app.on('activate', () => {
      if (mainWindow === null) createWindow();
    });
    return null;
  })
  .catch(console.log);
