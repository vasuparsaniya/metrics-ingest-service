import { waitForTargetLock } from '../../scripts/load/restart-observer';

describe('restart lock observation', () => {
  it('allows preparation beyond the old 1.7-second deadline', async () => {
    let now = 0;
    const result = await waitForTargetLock({
      blockerPid: 42,
      read: () =>
        Promise.resolve(
          now >= 2500
            ? [{ pid: 10, waitEventType: 'Lock', blockerPids: [42] }]
            : [],
        ),
      ended: () => false,
      now: () => now,
      pause: () => {
        now += 500;
        return Promise.resolve();
      },
    });
    expect(result.elapsedMs).toBe(2500);
    expect(result.waiterPid).toBe(10);
  });
  it('does not accept another blocker or non-lock activity', async () => {
    let now = 0;
    await expect(
      waitForTargetLock({
        blockerPid: 42,
        read: () =>
          Promise.resolve([
            { pid: 1, waitEventType: 'Lock', blockerPids: [99] },
            { pid: 2, waitEventType: 'IO', blockerPids: [42] },
          ]),
        ended: () => false,
        timeoutMs: 100,
        now: () => now,
        pause: () => {
          now += 50;
          return Promise.resolve();
        },
      }),
    ).rejects.toThrow('target blocker');
  });
  it('fails immediately when the writer workload ended', async () => {
    const read = jest.fn(() => Promise.resolve([]));
    await expect(
      waitForTargetLock({ blockerPid: 42, read, ended: () => true }),
    ).rejects.toThrow('workload ended');
    expect(read).toHaveBeenCalledTimes(1);
  });
});
