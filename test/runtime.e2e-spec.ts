import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { monitorRss } from '../scripts/load/rss';
import { saveCpuProfile } from '../scripts/load/cpu-profile';
import { mkdtemp, readFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { isRecord } from '../src/ingest/ingest.validation';

describe('real child-process RSS telemetry', () => {
  function child(profilePath?: string) {
    return spawn(
      process.execPath,
      [
        '-r',
        'ts-node/register',
        '--require',
        resolve('src/benchmark/rss-preload.ts'),
        ...(profilePath
          ? ['--require', resolve('src/benchmark/cpu-profile-preload.ts')]
          : []),
        '-e',
        'setInterval(() => {}, 1000)',
      ],
      {
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        env: {
          ...process.env,
          ...(profilePath
            ? { METRICS_BENCHMARK_CPU_PROFILE_PATH: profilePath }
            : {}),
        },
      },
    );
  }

  it('saves an API-child CPU profile before terminating and cleans up IPC listeners', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'metrics-api-profile-'));
    const path = resolve(directory, 'test.cpuprofile');
    const processChild = child(path);
    const exited = once(processChild, 'exit');
    const monitor = monitorRss(processChild);
    try {
      await once(processChild, 'message', {
        signal: AbortSignal.timeout(10000),
      });
      await delay(100);
      await monitor.stop();
      await saveCpuProfile(processChild, path);
      const profile: unknown = JSON.parse(await readFile(path, 'utf8'));
      expect(
        isRecord(profile) &&
          Array.isArray(profile.nodes) &&
          profile.nodes.length > 0,
      ).toBe(true);
      expect(
        isRecord(profile) &&
          Array.isArray(profile.samples) &&
          profile.samples.length > 0,
      ).toBe(true);
      expect(processChild.listenerCount('message')).toBe(0);
      expect(processChild.exitCode).toBeNull();
    } finally {
      processChild.kill('SIGTERM');
      await exited;
      await monitor.stop();
      await unlink(path).catch(() => undefined);
      await rmdir(directory);
    }
  });

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
