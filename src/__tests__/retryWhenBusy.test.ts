import retryWhenBusy from '../main/functions/retryWhenBusy';

const busy = () =>
  Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });

describe('retryWhenBusy', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns the result without waiting when the first try works', async () => {
    const operation = jest.fn(() => 42);
    await expect(retryWhenBusy(operation)).resolves.toBe(42);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('tries again after a busy database and returns the later result', async () => {
    let calls = 0;
    const operation = jest.fn(() => {
      calls += 1;
      if (calls < 3) throw busy();
      return 7;
    });
    const result = retryWhenBusy(operation);
    await jest.advanceTimersByTimeAsync(100 + 200);
    await expect(result).resolves.toBe(7);
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('gives up after five tries and throws the busy error', async () => {
    const operation = jest.fn(() => {
      throw busy();
    });
    const result = retryWhenBusy(operation);
    const outcome = result.catch((error: Error) => error);
    await jest.advanceTimersByTimeAsync(100 + 200 + 300 + 400);
    expect(((await outcome) as Error).message).toBe('database is locked');
    expect(operation).toHaveBeenCalledTimes(5);
  });

  it('does not retry any other error', async () => {
    const operation = jest.fn(() => {
      throw new Error('UNIQUE constraint failed');
    });
    await expect(retryWhenBusy(operation)).rejects.toThrow(
      'UNIQUE constraint failed',
    );
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
