import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EVENT_FLOW_RULES } from '../../src/analyzers/event-flow/checks';
import { LIFECYCLE_RULES } from '../../src/analyzers/lifecycle/checks';
import { stateFieldAccessor, stateFieldMissing, stateFieldUnsupportedType, transitionMethodMissing, unknownStateValue } from '../../src/analyzers/lifecycle/problems';
import { eventNotAnalysed, sagaOutcomeUnhandled } from '../../src/analyzers/event-flow/problems';
import { run } from '../../src/cli/run';
import { PROBLEM_ANALYZERS, Problem, RULE_ANALYZERS } from '../../src/finding';
import { formatJson } from '../../src/report/json';
import { captureIo } from '../helpers/disk';
import { JSON_FIXTURES } from '../helpers/fixtures';
import { TOOL, finding } from '../helpers/model';
import { REPORT_SCHEMA, validateReport } from '../helpers/schema';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const fixture = (name: string): string => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

const checkJson = async (dir: string, extra: readonly string[] = []): Promise<string> => {
  const { io, stdout } = captureIo(dir);
  await run(['check', '--format', 'json', ...extra], io);
  return stdout();
};

const baselinedRun = async (dir: string): Promise<string> => {
  const path = join(realpathSync(mkdtempSync(join(tmpdir(), 'domain-integrity-schema-'))), 'baseline.json');
  await run(['check', '--update-baseline', '--baseline', path], captureIo(dir).io);
  return checkJson(dir, ['--baseline', path]);
};

const EVERY_PROBLEM: readonly Problem[] = [
  stateFieldAccessor('Order', 'status'),
  stateFieldMissing('Order', 'state'),
  stateFieldUnsupportedType('Order', 'status', 'string'),
  unknownStateValue('Order', 'status', 'ARCHIVED', ['PENDING']),
  transitionMethodMissing('Order', 'reopen'),
  eventNotAnalysed('Paid'),
  sagaOutcomeUnhandled('OrderSaga', 'Paid', 'Failed'),
];

type FindingDefinition = {
  readonly properties: { readonly ruleId: { readonly enum: readonly string[] } };
  readonly allOf: readonly { readonly if: { readonly properties: { readonly ruleId: { readonly const: string } } } }[];
};

type ProblemDefinition = {
  readonly properties: { readonly code: { readonly enum: readonly string[] } };
  readonly allOf: readonly { readonly if: { readonly properties: { readonly code: { readonly const: string } } } }[];
};

const definitions = REPORT_SCHEMA.$defs as { readonly finding: FindingDefinition; readonly problem: ProblemDefinition };

const sorted = (values: Iterable<string>): string[] => [...values].sort();

describe('report schema', () => {
  it.each(JSON_FIXTURES)('accepts the JSON report of %s', async (name) => {
    expect(validateReport(await checkJson(fixture(name)))).toEqual([]);
  });

  it.each(JSON_FIXTURES)('accepts the baselined JSON report of %s', async (name) => {
    expect(validateReport(await baselinedRun(fixture(name)))).toEqual([]);
  });

  it('accepts a report without findings', () => {
    expect(validateReport(formatJson({ fresh: [], known: [], problems: [], rules: [], root: '/app' }, TOOL))).toEqual([]);
  });

  it('accepts a report with one problem of every code', () => {
    expect(validateReport(formatJson({ fresh: [], known: [], problems: EVERY_PROBLEM, rules: [], root: '/app' }, TOOL))).toEqual([]);
  });

  it('rejects a report with an unknown key', () => {
    const report = JSON.parse(formatJson({ fresh: [], known: [], problems: [], rules: [], root: '/app' }, TOOL));

    expect(validateReport(JSON.stringify({ ...report, extra: true }))).not.toEqual([]);
  });

  it('lists exactly the registered rules', () => {
    expect(sorted(definitions.finding.properties.ruleId.enum)).toEqual(sorted([...LIFECYCLE_RULES, ...EVENT_FLOW_RULES].map((rule) => rule.id)));
  });

  it('lists exactly the rules the finding model knows', () => {
    expect(sorted(definitions.finding.properties.ruleId.enum)).toEqual(sorted(Object.keys(RULE_ANALYZERS)));
  });

  it('describes the details of every rule', () => {
    expect(sorted(definitions.finding.allOf.map((branch) => branch.if.properties.ruleId.const))).toEqual(sorted(Object.keys(RULE_ANALYZERS)));
  });

  it('lists exactly the problem codes', () => {
    expect(sorted(definitions.problem.properties.code.enum)).toEqual(sorted(Object.keys(PROBLEM_ANALYZERS)));
  });

  it('describes the details of every problem code', () => {
    expect(sorted(definitions.problem.allOf.map((branch) => branch.if.properties.code.const))).toEqual(sorted(Object.keys(PROBLEM_ANALYZERS)));
  });

  it('ships the schema in the package tarball', () => {
    const [pack] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT, encoding: 'utf8' })) as [{ files: { path: string }[] }];

    expect(pack.files.map((file) => file.path)).toContain('schema/report.schema.json');
  });

  const manifest = (): { exports: Record<string, string> } => JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

  it('exports the schema from the package', () => {
    expect(manifest().exports['./schema/report.json']).toBe('./schema/report.schema.json');
  });

  it('exports a schema file that exists', () => {
    expect(existsSync(join(ROOT, manifest().exports['./schema/report.json'] ?? ''))).toBe(true);
  });

  it('rejects a finding whose details carry an extra key', () => {
    const report = JSON.parse(formatJson({ fresh: [finding()], known: [], problems: [], rules: [], root: '/app' }, TOOL));
    const [first] = report.findings;

    expect(validateReport(JSON.stringify({ ...report, findings: [{ ...first, details: { ...first.details, extra: true } }] }))).not.toEqual([]);
  });

  it('rejects a finding whose details belong to another rule', () => {
    const report = JSON.parse(formatJson({ fresh: [finding()], known: [], problems: [], rules: [], root: '/app' }, TOOL));
    const [first] = report.findings;

    expect(validateReport(JSON.stringify({ ...report, findings: [{ ...first, ruleId: 'unhandled-event', analyzer: 'event-flow' }] }))).not.toEqual([]);
  });
});
