import path from 'path';
import { app, BrowserWindow, shell, dialog, session, ipcMain } from 'electron';
import MenuBuilder from './menu';
import {
  isSameAppPage,
  isWebLink,
  resolveHtmlPath,
  resolvePreloadPath,
} from './util';
import './ipcHandlers/SailorHandler';
import './ipcHandlers/EventHandler';
import './ipcHandlers/HeatRaceHandler';
import './ipcHandlers/ExportHandler';
import { startProblemReportOutbox } from './ipcHandlers/ProblemReportHandler';
import { setCallObserver } from './ipcHandlers/handle';
import { autoBackup, dbPath } from './database/DBManager';
import { journalObserver } from './functions/changeJournal';
import convertEventsAtStartup from './functions/startupConversion';
import { logError, setErrorLogDir } from './errorLog';
import { newErrorRef } from '../shared/errors/explainError';
import type { BackupStatus } from '../shared/ipc';
import sendToWindow from './windowMessages';

// Every error is written to logs/errors.log next to the database.
setErrorLogDir(path.join(path.dirname(dbPath), 'logs'), app.getVersion());

// Group what each IPC call writes into one entry of the event history.
setCallObserver(journalObserver);

// An unexpected error outside an IPC call (each call already reports its own
// failure to the screen) must not take the app down mid-race: results are
// written in transactions, so log it and keep running.
process.on('uncaughtException', (error) => {
  logError('main process (uncaught exception)', error, {
    ref: newErrorRef(),
    kind: 'unexpected',
  });
});
process.on('unhandledRejection', (reason) => {
  logError('main process (unhandled rejection)', reason, {
    ref: newErrorRef(),
    kind: 'unexpected',
  });
});

// Errors in the window itself (see renderer/utils/userFeedback.ts). The
// contract's `WindowErrorEntry` (shared/ipc.ts) is what a correct window
// sends; the entry is read as untrusted input all the same.
ipcMain.on('app:logError', (_event, entry: unknown) => {
  const { where, message, stack, ref } = (entry ?? {}) as {
    where?: string;
    message?: string;
    stack?: string;
    ref?: string;
  };
  const error = new Error(String(message ?? '').slice(0, 2000));
  if (stack) error.stack = String(stack).slice(0, 8000);
  logError(`window: ${String(where ?? 'unknown').slice(0, 300)}`, error, {
    ref: ref ? String(ref).slice(0, 20) : undefined,
    kind: 'window',
  });
});

// One copy of the app at a time: a second window on the same data file
// would keep its own view of the heats and the two would write over each
// other. Opening the app again (a double double-click) brings the open
// window to the front instead. The automated tests run several copies, each
// on its own data file, so they skip this.
const singleInstance =
  Boolean(process.env.SCORING_APP_DB_PATH) || app.requestSingleInstanceLock();

let mainWindow: BrowserWindow | null = null;

/**
 * Whether the automatic backups work. When they stop (disk full, folder not
 * writable) the window shows a warning that stays until they work again;
 * the status is sent again whenever the page (re)loads.
 */
let backupStatus: BackupStatus = { ok: true };

const backupFailureReason = (error: unknown): string => {
  const text = `${(error as { code?: unknown })?.code ?? ''} ${
    (error as Error)?.message ?? ''
  }`;
  if (/FULL|ENOSPC|disk is full/i.test(text)) {
    return 'The disk is full. Free some space on this computer.';
  }
  if (/READONLY|CANTOPEN|EACCES|EPERM|EROFS|read-only/i.test(text)) {
    return 'The backups folder cannot be written to. Check that the drive is connected and not read-only.';
  }
  return 'Check the free disk space. Details are in the error log (Help menu > Open Error Log).';
};

autoBackup.onStatus(({ ok, error }: { ok: boolean; error?: unknown }) => {
  if (!ok) {
    logError('automatic backup', error, {
      ref: newErrorRef(),
      kind: 'backup',
    });
  }
  backupStatus = ok ? { ok } : { ok, reason: backupFailureReason(error) };
  sendToWindow(mainWindow?.webContents, 'app:backupStatus', backupStatus);
});

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
// loads same-origin bundles plus data: URIs (inline flag SVGs, fonts Vite
// inlined) and uses inline style attributes, so we can keep this tight. In
// development the Vite dev server's hot reload needs looser rules: its React
// Refresh preamble is an inline script, and it talks over a websocket.
const buildContentSecurityPolicy = (): string => {
  const scriptSrc = isDebug
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
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

  return (
    installer
      .default(
        extensions.map((name: string) => installer[name]),
        forceDownload,
      )
      // eslint-disable-next-line no-console -- dev-only devtools install; failure is not worth a user-facing error
      .catch(console.log)
  );
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
      // Open filling the screen: on a 1366x768 laptop the old 1024x728
      // window cut the leaderboard, and not everyone knows to maximise it.
      mainWindow.maximize();
      mainWindow.show();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(mainWindow, {
    backupsDir: autoBackup.dir,
    errorLogDir: path.join(path.dirname(dbPath), 'logs'),
  });
  menuBuilder.buildMenu();

  // If the page itself dies (out of memory on a small laptop, a GPU fault),
  // the window would stay blank. Every result is already in the database,
  // so load the page again; a reload loop is stopped after a few tries.
  let reloads = 0;
  mainWindow.webContents.on('did-finish-load', () => {
    if (!backupStatus.ok) {
      sendToWindow(mainWindow?.webContents, 'app:backupStatus', backupStatus);
    }
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logError('window stopped', details, {
      ref: newErrorRef(),
      kind: 'unexpected',
    });
    if (details.reason === 'clean-exit' || !mainWindow) return;
    reloads += 1;
    if (reloads <= 3) {
      mainWindow.reload();
    } else {
      dialog.showErrorBox(
        'IOM Regatta Manager stopped working',
        'The window failed several times. All saved results are safe in the database. Please close and restart the app.',
      );
    }
  });

  mainWindow.webContents.setWindowOpenHandler((edata) => {
    if (isWebLink(edata.url)) shell.openExternal(edata.url);
    return { action: 'deny' };
  });

  // A file dropped anywhere on the window (a CSV meant for the import) made
  // the window navigate to that file: the app vanished and, with no Reload in
  // the packaged menu, only a restart brought it back.
  mainWindow.webContents.on('will-navigate', (navigation, url) => {
    const current = mainWindow?.webContents.getURL() ?? '';
    if (isSameAppPage(url, current)) return;
    navigation.preventDefault();
    if (isWebLink(url)) shell.openExternal(url);
  });
};

// Final safety copy of anything scored since the last periodic backup.
app.on('before-quit', () => {
  if (!singleInstance) return;
  autoBackup.stop();
  autoBackup.backupIfChanged();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

app
  .whenReady()
  .then(() => {
    if (!singleInstance) return null;
    applyContentSecurityPolicy();
    // Start-up copy, then rolling copies while results are being entered.
    autoBackup.backupNow();
    autoBackup.start();
    // Problem reports saved while offline go out once there is a connection.
    startProblemReportOutbox();
    try {
      // Events from before regatta-core get their log now (each logs its
      // own failure; this only guards the start against the unexpected).
      convertEventsAtStartup();
    } catch (error) {
      logError('Moving events to the new scoring', error);
    }
    createWindow();
    app.on('activate', () => {
      if (mainWindow === null) createWindow();
    });
    return null;
  })
  .catch((error) => {
    logError('starting the app', error, {
      ref: newErrorRef(),
      kind: 'unexpected',
    });
    dialog.showErrorBox(
      'IOM Regatta Manager could not start',
      'The window could not be opened. Your saved results are safe. Close the app and start it again; if it happens again, send the error log (Help menu > Open Error Log, or the logs folder next to the data file).',
    );
  });
