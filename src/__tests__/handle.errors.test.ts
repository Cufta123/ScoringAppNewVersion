/** @jest-environment node */
import fs from 'fs';
import os from 'os';
import path from 'path';

// What crosses from the main process to the window when a call fails: the
// app's own refusal as it is, a database failure in plain words, a fault in
// the app as "unexpected" with a code — and every one of them in the log.

const registered: Record<string, (...args: any[]) => Promise<unknown>> = {};

jest.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, listener: any) => {
      registered[channel] = listener;
    },
  },
}));

// eslint-disable-next-line import/first
import handle from '../main/ipcHandlers/handle';
// eslint-disable-next-line import/first
import { setErrorLogDir } from '../main/errorLog';

class SqliteError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

describe('handle(): failures reach the window in words the user can act on', () => {
  let dir: string;
  const log = () => fs.readFileSync(path.join(dir, 'errors.log'), 'utf8');

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'error-log-'));
    setErrorLogDir(dir, '9.9.9');
  });
  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const failWith = async (error: unknown) => {
    handle('failing', () => {
      throw error;
    });
    try {
      await registered.failing({});
    } catch (thrown) {
      return thrown as Error;
    }
    throw new Error('expected the call to fail');
  };

  it('passes a refusal through unchanged, and logs it', async () => {
    const refusal = new Error('Heat B3 has not raced yet.');
    const thrown = await failWith(refusal);
    expect(thrown).toBe(refusal);
    expect(log()).toContain('IPC "failing"');
    expect(log()).toContain('refusal');
  });

  it('explains a database failure', async () => {
    const thrown = await failWith(
      new SqliteError('database or disk is full', 'SQLITE_FULL'),
    );
    expect(thrown.message).toMatch(/^The disk is full\./);
    expect(log()).toContain('code: SQLITE_FULL');
  });

  it('turns a fault in the app into "unexpected" with a code that is in the log', async () => {
    const thrown = await failWith(
      new TypeError("Cannot read properties of undefined (reading 'x')"),
    );
    expect(thrown.message).toMatch(/unexpected problem/);
    const ref = thrown.message.match(/note the code (\w+)/)?.[1];
    expect(ref).toBeTruthy();
    expect(log()).toContain(`ref ${ref}`);
    expect(log()).toContain('v9.9.9');
    expect(log()).toContain('TypeError: Cannot read properties of undefined');
  });

  it('starts a new file once the log passes 1 MB, keeping the previous one', async () => {
    fs.writeFileSync(path.join(dir, 'errors.log'), 'x'.repeat(1024 * 1024 + 1));
    await failWith(new Error('A refusal.'));
    expect(fs.existsSync(path.join(dir, 'errors.1.log'))).toBe(true);
    expect(log()).toContain('A refusal.');
    expect(log().length).toBeLessThan(10_000);
  });

  it('still reports the failure when the log cannot be written', async () => {
    setErrorLogDir(path.join(dir, 'errors.log', 'not-a-dir'));
    fs.writeFileSync(path.join(dir, 'errors.log'), '');
    const thrown = await failWith(new Error('A refusal.'));
    expect(thrown.message).toBe('A refusal.');
  });
});
