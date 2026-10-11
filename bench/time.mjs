import { spawnSync } from 'node:child_process';
import { loadavg } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    runs: { type: 'string', default: '3' },
    cli: { type: 'string', default: resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.js') },
  },
});

if (positionals.length === 0) {
  process.stderr.write('usage: time.mjs [--runs n] [--cli path/to/cli.js] <project-dir>...\n');
  process.exit(2);
}

const runs = Number(values.runs);

const median = (numbers) => {
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const timeOnce = (project) => {
  const started = process.hrtime.bigint();
  const result = spawnSync(process.execPath, [values.cli, 'check', '-p', join(project, 'tsconfig.json'), '-c', join(project, 'domain.config.ts'), '--format', 'json'], {
    cwd: project,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  return { seconds: Number(process.hrtime.bigint() - started) / 1e9, status: result.status };
};

const loadText = () => loadavg().map((load) => load.toFixed(2)).join(' ');

positionals.forEach((project) => {
  const loadBefore = loadText();
  const samples = Array.from({ length: runs }, () => timeOnce(resolve(project)));
  const seconds = samples.map((sample) => sample.seconds);
  const statuses = [...new Set(samples.map((sample) => sample.status))].join(',');
  process.stdout.write(
    `${project}\tmedian ${median(seconds).toFixed(2)} s\truns ${seconds.map((value) => value.toFixed(2)).join(' ')}\texit ${statuses}\tload ${loadBefore} -> ${loadText()}\n`,
  );
});
