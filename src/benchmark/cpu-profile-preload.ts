// Loaded only for explicitly profiled benchmark-owned API processes.
import { Session } from 'node:inspector';
import { writeFile } from 'node:fs/promises';

const path = process.env.METRICS_BENCHMARK_CPU_PROFILE_PATH;
if (!path) throw new Error('CPU profile output path is required');
const session = new Session();
session.connect();
let startupError: Error | null = null;
session.post('Profiler.enable', (error) => {
  if (error) startupError = error;
  else
    session.post('Profiler.start', (startError) => {
      startupError = startError;
    });
});
let stopping = false;
process.on('message', (message: unknown) => {
  if (
    typeof message !== 'object' ||
    message === null ||
    !('kind' in message) ||
    message.kind !== 'cpu:stop' ||
    !('id' in message) ||
    typeof message.id !== 'string' ||
    stopping
  )
    return;
  stopping = true;
  const id = message.id;
  const respond = (error?: string): void => {
    session.disconnect();
    if (process.connected && process.send)
      process.send({ kind: 'cpu:saved', id, pid: process.pid, path, error });
  };
  if (startupError) {
    respond(startupError.message);
    return;
  }
  session.post('Profiler.stop', (error, result) => {
    if (error) {
      respond(error.message);
      return;
    }
    void writeFile(path, JSON.stringify(result.profile), { flag: 'wx' })
      .then(() => respond())
      .catch((failure: unknown) =>
        respond(failure instanceof Error ? failure.message : String(failure)),
      );
  });
});
process.once('disconnect', () => session.disconnect());
