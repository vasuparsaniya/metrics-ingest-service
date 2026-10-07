import { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

/** Validates self-measurement messages from only the selected API process and run. */
export function rssReading(
  message: unknown,
  pid: number | undefined,
  measurementId: string,
): { kind: 'rss:sample' | 'rss:stopped'; rssBytes: number } | null {
  if (
    typeof pid !== 'number' ||
    typeof message !== 'object' ||
    message === null ||
    !('kind' in message) ||
    (message.kind !== 'rss:sample' && message.kind !== 'rss:stopped') ||
    !('pid' in message) ||
    message.pid !== pid ||
    !('measurementId' in message) ||
    message.measurementId !== measurementId ||
    !('rssBytes' in message) ||
    typeof message.rssBytes !== 'number' ||
    !Number.isSafeInteger(message.rssBytes) ||
    message.rssBytes <= 0
  )
    return null;
  return { kind: message.kind, rssBytes: message.rssBytes };
}

/** Measures API-process RSS portably over IPC, never the load generator's memory. */
export function monitorRss(child: ChildProcess) {
  const measurementId = randomUUID();
  let peakBytes = 0;
  let samples = 0;
  let finalSampleReceived = false;
  const errors: string[] = [];
  let complete: (() => void) | undefined;
  let stopped: Promise<void> | undefined;
  const receive = (message: unknown): void => {
    const reading = rssReading(message, child.pid, measurementId);
    if (!reading) return;
    peakBytes = Math.max(peakBytes, reading.rssBytes);
    samples += 1;
    if (reading.kind === 'rss:stopped') {
      finalSampleReceived = true;
      complete?.();
    }
  };
  const exited = (): void => {
    complete?.();
  };
  const send = (kind: 'rss:start' | 'rss:stop'): void => {
    if (!child.connected || !child.send) {
      if (kind === 'rss:start')
        errors.push('API child has no connected IPC channel');
      complete?.();
      return;
    }
    child.send({ kind, measurementId }, (error) => {
      if (error) {
        errors.push(error.message);
        complete?.();
      }
    });
  };
  child.on('message', receive);
  child.on('exit', exited);
  send('rss:start');
  return {
    async stop() {
      stopped ??= new Promise<void>((done) => {
        complete = done;
        if (
          !child.connected ||
          child.exitCode !== null ||
          child.signalCode !== null
        ) {
          done();
          return;
        }
        const timeout = setTimeout(() => {
          errors.push('Final RSS sample timed out');
          done();
        }, 2000);
        complete = () => {
          clearTimeout(timeout);
          done();
        };
        send('rss:stop');
      }).finally(() => {
        child.off('message', receive);
        child.off('exit', exited);
      });
      await stopped;
      return {
        source: 'process.memoryUsage.rss() in API child over Node IPC',
        pid: child.pid,
        intervalMs: 100,
        samples,
        peakBytes: samples ? peakBytes : null,
        finalSampleReceived,
        targetBytes: 512 * 1024 * 1024,
        passes: samples
          ? errors.length === 0 && peakBytes < 512 * 1024 * 1024
          : null,
        errors: [...errors],
      };
    },
  };
}

/** Makes native Windows termination explicit instead of claiming POSIX signal semantics. */
export function terminationSemantics(os = process.platform) {
  return {
    platform: os,
    requestedSignal: 'SIGTERM',
    mode: os === 'win32' ? 'windows-forced-termination' : 'posix-sigterm',
    posixSigtermScenario: os !== 'win32',
  };
}
