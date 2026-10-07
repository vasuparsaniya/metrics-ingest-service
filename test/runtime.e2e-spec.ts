import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { monitorRss } from '../scripts/load/rss';

describe('real child-process RSS telemetry', () => {
  function child() {
    return spawn(
      process.execPath,
      [
        '-r',
        'ts-node/register',
        '--require',
        resolve('src/benchmark/rss-preload.ts'),
        '-e',
        'setInterval(() => {}, 1000)',
      ],
      { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
    );
  }

  it('reports the child RSS through IPC with a final sample and detaches listeners', async () => {
    const processChild = child();
    const exited = once(processChild, 'exit');
    const monitor = monitorRss(processChild);
    try {
      await once(processChild, 'message', {
        signal: AbortSignal.timeout(10000),
      });
      const report = await monitor.stop();
      expect(report.pid).toBe(processChild.pid);
      expect(report.samples).toBeGreaterThanOrEqual(2);
      expect(report.peakBytes).toBeGreaterThan(0);
      expect(report.finalSampleReceived).toBe(true);
      expect(report.errors).toEqual([]);
      expect(processChild.listenerCount('message')).toBe(0);
      expect(await monitor.stop()).toEqual(report);
    } finally {
      processChild.kill('SIGTERM');
      await exited;
      await monitor.stop();
    }
  });

  it('retains real samples and completes without waiting for an exited child', async () => {
    const processChild = child();
    const exited = once(processChild, 'exit');
    const monitor = monitorRss(processChild);
    try {
      await once(processChild, 'message', {
        signal: AbortSignal.timeout(10000),
      });
      processChild.kill('SIGTERM');
      await exited;
      const report = await monitor.stop();
      expect(report.samples).toBeGreaterThan(0);
      expect(report.peakBytes).toBeGreaterThan(0);
      expect(report.finalSampleReceived).toBe(false);
      expect(processChild.listenerCount('message')).toBe(0);
    } finally {
      processChild.kill('SIGTERM');
      await exited;
      await monitor.stop();
    }
  });
});
