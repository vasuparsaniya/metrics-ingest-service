// This module is loaded only by benchmark-owned child processes via --require.
export {};

let timer: NodeJS.Timeout | undefined;
let measurementId: string | undefined;

function clearSampler(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}

function sample(kind: 'rss:sample' | 'rss:stopped'): void {
  if (!process.connected || !process.send || !measurementId) return;
  process.send(
    {
      kind,
      measurementId,
      pid: process.pid,
      rssBytes: process.memoryUsage.rss(),
    },
    (error: Error | null) => {
      if (error) {
        clearSampler();
        process.stderr.write(
          `${JSON.stringify({ event: 'rss_telemetry_failed', errorType: error.name })}\n`,
        );
      }
    },
  );
}

if (process.send) {
  process.on('message', (message: unknown) => {
    if (
      typeof message !== 'object' ||
      message === null ||
      !('kind' in message) ||
      !('measurementId' in message) ||
      typeof message.measurementId !== 'string'
    )
      return;
    if (message.kind === 'rss:start') {
      clearSampler();
      measurementId = message.measurementId;
      sample('rss:sample');
      timer = setInterval(() => sample('rss:sample'), 100);
      timer.unref();
    } else if (
      message.kind === 'rss:stop' &&
      message.measurementId === measurementId
    ) {
      clearSampler();
      sample('rss:stopped');
      measurementId = undefined;
    }
  });
  process.on('disconnect', clearSampler);
}
