import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AnalyzerRun } from '../../src/analysis';
import { AnalysisInput, Analyzer, analyse } from '../../src/analyzer';
import { lifecycleAnalyzer } from '../../src/analyzers/lifecycle/analyzer';
import { run } from '../../src/cli/run';
import { packageVersion } from '../../src/cli/version';
import { TICKET_PROJECT, captureIo, writeProject } from '../helpers/disk';

const PACKAGE_VERSION: string = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;

const REPORT = `internal error in broken, please report (domain-integrity ${PACKAGE_VERSION})`;

const broken: Analyzer<string, never> = {
  id: 'broken',
  rules: [],
  extract: () => 'model',
  problems: () => [],
  suggest: () => [],
  check: () => {
    throw new Error('boom');
  },
  diagram: () => ({ kind: 'diagram', text: '' }),
  summarize: () => '',
  isEmpty: () => false,
};

const failingRun: AnalyzerRun = (input: AnalysisInput) => analyse(broken, input);

const ANALYZERS: readonly AnalyzerRun[] = [failingRun, (input) => analyse(lifecycleAnalyzer, input)];

const DEEP_STACK = ['Error: deep', '    at f1 (a.js:1:1)', '    at f2 (a.js:2:1)', '    at f3 (a.js:3:1)', '    at f4 (a.js:4:1)', '    at f5 (a.js:5:1)', '    at f6 (a.js:6:1)'].join('\n');

const throwing = (thrown: unknown): AnalyzerRun => (input: AnalysisInput) =>
  analyse(
    {
      ...broken,
      check: () => {
        throw thrown;
      },
    },
    input,
  );

const runBroken = async (argv: readonly string[], analyzers: readonly AnalyzerRun[] = ANALYZERS) => {
  const dir = writeProject(TICKET_PROJECT);
  const { io, stdout, stderr } = captureIo(dir);
  const code = await run(argv, io, analyzers);
  return { dir, code, stdout: stdout(), stderr: stderr() };
};

describe('an analyzer that throws', () => {
  it('keeps the text report of the other analyzers and exits 2', async () => {
    const { code, stdout } = await runBroken(['check']);

    expect({ code, leak: stdout.includes('terminal-state-leak  Ticket.rename()') }).toEqual({ code: 2, leak: true });
  });

  it('asks for a report naming the analyzer and the version', async () => {
    const { stderr } = await runBroken(['check']);

    expect(stderr).toContain(REPORT);
  });

  it('prints the error message of the failure', async () => {
    const { stderr } = await runBroken(['check']);

    expect(stderr).toContain('boom');
  });

  it('keeps the JSON findings of the other analyzers and exits 2', async () => {
    const { code, stdout } = await runBroken(['check', '--format', 'json']);

    expect({ code, methods: JSON.parse(stdout).findings.map((finding: { method: string }) => finding.method) }).toEqual({
      code: 2,
      methods: ['rename'],
    });
  });

  it('keeps the SARIF results of the other analyzers and exits 2', async () => {
    const { code, stdout } = await runBroken(['check', '--format', 'sarif']);

    expect({ code, results: JSON.parse(stdout).runs[0].results.length > 0 }).toEqual({ code: 2, results: true });
  });

  it('writes no baseline and exits 2', async () => {
    const { dir, code, stderr } = await runBroken(['check', '--update-baseline', '--baseline', 'baseline.json']);

    expect({ code, written: existsSync(join(dir, 'baseline.json')), report: stderr.includes(REPORT) }).toEqual({
      code: 2,
      written: false,
      report: true,
    });
  });

  it('explains why the baseline was not written', async () => {
    const { stderr } = await runBroken(['check', '--update-baseline']);

    expect(stderr).toContain('Baseline not written because of the internal error above.');
  });

  it('keeps the diagrams of the other analyzers and exits 2', async () => {
    const { code, stdout, stderr } = await runBroken(['show']);

    expect({ code, diagram: stdout.includes('Ticket'), report: stderr.includes(REPORT) }).toEqual({ code: 2, diagram: true, report: true });
  });

  it('keeps the summary of the other analyzers and exits 2', async () => {
    const { code, stdout, stderr } = await runBroken(['context']);

    expect({ code, summary: stdout.includes('Ticket'), report: stderr.includes(REPORT) }).toEqual({ code: 2, summary: true, report: true });
  });

  it('writes no context file and exits 2', async () => {
    const { dir, code } = await runBroken(['context', '--write', 'AGENTS.md']);

    expect({ code, written: existsSync(join(dir, 'AGENTS.md')) }).toEqual({ code: 2, written: false });
  });

  it('reports the failure alone when it is the only analyzer', async () => {
    const dir = writeProject(TICKET_PROJECT);
    const { io, stderr } = captureIo(dir);

    expect({ code: await run(['show'], io, [failingRun]), report: stderr().includes(REPORT) }).toEqual({ code: 2, report: true });
  });

  it('shortens the trace to the message and five frames', async () => {
    const { stderr } = await runBroken(['check'], [throwing(Object.assign(new Error('deep'), { stack: DEEP_STACK }))]);

    expect({ fifth: stderr.includes('at f5'), sixth: stderr.includes('at f6') }).toEqual({ fifth: true, sixth: false });
  });

  it('reports a thrown value that cannot be converted to a string', async () => {
    const { code, stderr } = await runBroken(['check'], [throwing(Object.create(null))]);

    expect({ code, reported: stderr.includes(`${REPORT}\n{}`) }).toEqual({ code: 2, reported: true });
  });
});

describe('packageVersion', () => {
  it('reads the version of the domain-integrity package', () => {
    expect(packageVersion()).toBe(PACKAGE_VERSION);
  });
});
