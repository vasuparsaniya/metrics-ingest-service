import { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

/** Flushes the owned API profile before termination, with bounded IPC waiting. */
export function saveCpuProfile(
  child: ChildProcess,
  path: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const id = randomUUID();
    const finish = (error?: Error): void => {
      clearTimeout(timeout);
      child.off('message', receive);
      child.off('exit', exited);
      if (error) reject(error);
      else resolve();
    };
    const exited = (): void =>
      finish(new Error('API exited before CPU profile was saved'));
    const receive = (message: unknown): void => {
      if (
        typeof message !== 'object' ||
        message === null ||
        !('kind' in message) ||
        message.kind !== 'cpu:saved' ||
        !('id' in message) ||
        message.id !== id ||
        !('pid' in message) ||
        message.pid !== child.pid ||
        !('path' in message) ||
        message.path !== path
      )
        return;
      finish(
        'error' in message && typeof message.error === 'string'
          ? new Error(message.error)
          : undefined,
      );
    };
    const timeout = setTimeout(
      () => finish(new Error('CPU profile save timed out')),
      15000,
    );
    child.on('message', receive);
    child.once('exit', exited);
    if (!child.connected || !child.send) {
      finish(new Error('CPU profiling requires connected API IPC'));
      return;
    }
    child.send({ kind: 'cpu:stop', id }, (error) => {
      if (error) finish(error);
    });
  });
}
