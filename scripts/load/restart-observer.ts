import { setTimeout as delay } from 'node:timers/promises';

/** Carries blocker evidence needed to distinguish the target batch from unrelated writes. */
export interface InsertActivity {
  pid: number;
  waitEventType: string | null;
  blockerPids: number[];
}

/** Wait for the actual test blocker, not a deadline relative to batch preparation. */
export async function waitForTargetLock(options: {
  blockerPid: number;
  read(): Promise<InsertActivity[]>;
  ended(): boolean;
  timeoutMs?: number;
  now?: () => number;
  pause?: () => Promise<void>;
}): Promise<{ waiterPid: number; elapsedMs: number; polls: number }> {
  const now = options.now ?? Date.now;
  const pause = options.pause ?? (() => delay(25));
  const start = now();
  const timeoutMs = options.timeoutMs ?? 10000;
  let polls = 0;
  while (now() - start < timeoutMs) {
    const activity = await options.read();
    polls += 1;
    const target = activity.find(
      (row) =>
        row.waitEventType === 'Lock' &&
        row.blockerPids.includes(options.blockerPid),
    );
    if (target)
      return { waiterPid: target.pid, elapsedMs: now() - start, polls };
    if (options.ended())
      throw new Error(
        'Restart workload ended before observing the target blocker',
      );
    await pause();
  }
  throw new Error(
    `Did not observe an insertion waiting on the target blocker within ${timeoutMs / 1000} seconds`,
  );
}

/** Preserves the failed recovery report location while retaining the original cause. */
export class RestartScenarioError extends Error {
  constructor(
    message: string,
    readonly failureReport: string,
    cause: unknown,
  ) {
    super(message, { cause });
  }
}
