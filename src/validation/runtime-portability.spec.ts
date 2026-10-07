import { ChildProcess } from 'node:child_process';
import {
  rssReading,
  monitorRss,
  terminationSemantics,
} from '../../scripts/load/rss';
import { npmInvocation } from '../../scripts/setup-load';

describe('portable benchmark process tools', () => {
  it('accepts only RSS from the measured API PID and measurement window', () => {
    const reading = {
      kind: 'rss:sample',
      measurementId: 'window',
      pid: 123,
      rssBytes: 1000000,
    };
    expect(rssReading(reading, 123, 'window')).toEqual({
      kind: 'rss:sample',
      rssBytes: 1000000,
    });
    expect(rssReading(reading, 456, 'window')).toBeNull();
    expect(rssReading(reading, 123, 'other')).toBeNull();
    expect(rssReading({ ...reading, rssBytes: -1 }, 123, 'window')).toBeNull();
    expect(rssReading({ ...reading, rssBytes: NaN }, 123, 'window')).toBeNull();
    expect(rssReading({ ...reading, kind: {} }, 123, 'window')).toBeNull();
    expect(rssReading(null, 123, 'window')).toBeNull();
  });
  it('reports missing IPC as unavailable, not as zero memory, and cleans listeners', async () => {
    const child = new ChildProcess();
    const monitor = monitorRss(child);
    const report = await monitor.stop();
    expect(report.samples).toBe(0);
    expect(report.peakBytes).toBeNull();
    expect(report.passes).toBeNull();
    expect(report.errors).toContain('API child has no connected IPC channel');
    expect(child.listenerCount('message')).toBe(0);
    expect(child.listenerCount('exit')).toBe(0);
    expect(await monitor.stop()).toEqual(report);
  });
  it('invokes npm through Node without shell quoting or a .cmd executable', () => {
    for (const cli of [
      '/opt/node/lib/node_modules/npm/bin/npm-cli.js',
      'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',
    ]) {
      expect(npmInvocation({ npm_execpath: cli })).toEqual({
        program: process.execPath,
        args: [cli, 'run', 'load'],
      });
    }
    expect(() => npmInvocation({})).toThrow('npm run load:setup');
  });
  it('does not label Windows forced termination as POSIX SIGTERM', () => {
    expect(terminationSemantics('win32').posixSigtermScenario).toBe(false);
    expect(terminationSemantics('win32').mode).toBe(
      'windows-forced-termination',
    );
    expect(terminationSemantics('linux').posixSigtermScenario).toBe(true);
    expect(terminationSemantics('darwin').posixSigtermScenario).toBe(true);
  });
});
