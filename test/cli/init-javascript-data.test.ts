import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractLifecycles } from '../../src/analyzers/lifecycle/extract';
import { run } from '../../src/cli/run';
import { DEFAULT_DECLARATION } from '../../src/engine/declaration';
import { configSourceFile, loadProject } from '../../src/engine/project';
import { readDeclaration } from '../../src/engine/read-config';
import { describeSources } from '../helpers/describe';
import { captureIo, writeProject } from '../helpers/disk';
import { checkJson, declarationIn } from '../helpers/init-project';

const ticket = (language: 'js' | 'ts', guarded: boolean) => `
class AggregateRoot {}
export class Ticket extends AggregateRoot {
  ${language === 'ts' ? 'closed: boolean; label: string;' : ''}
  constructor(label = '') { super(); this.closed = false; this.label = label; }
  close() { if (this.closed) return; this.closed = true; }
  rename(label = '') { ${guarded ? 'if (this.closed) return;' : ''} this.label = label; }
}
`;

const config = (extension: string) => `
import { defineDomain, lifecycle } from 'domain-integrity';
import { Ticket } from './src/ticket.${extension}';
export default defineDomain({ lifecycles: [lifecycle(Ticket, { states: { closed: { terminal: true } } })] });
throw new Error('static config must not execute');
`;

const writeFixture = (language: 'js' | 'ts', guarded: boolean, explicit = false, extra: Readonly<Record<string, string>> = {}) =>
  writeProject({
    [`src/ticket.${language}`]: ticket(language, guarded),
    ...(explicit ? { 'domain.config.ts': config(language) } : {}),
    ...extra,
  }, { allowJs: true, checkJs: true, noEmit: true, allowImportingTsExtensions: true });

const projectIn = (dir: string) => loadProject(join(dir, 'tsconfig.json'), join(dir, 'domain.config.ts'), dir);

const extractedIn = (dir: string) => {
  const project = projectIn(dir);
  const configFile = configSourceFile(project, join(dir, 'domain.config.ts'), dir);
  const declaration = readDeclaration(configFile, 'domain.config.ts').declaration;
  return extractLifecycles({ files: project.getSourceFiles(), configFile, declaration, projectRoot: dir, repositoryRoot: dir });
};

for (const language of ['js', 'ts'] as const) {
  describe(`${language} constructor data CLI`, () => {
    it('uses diagnostic-free allowJs and checkJs sources', () => {
      const dir = writeFixture(language, true);

      const diagnostics = projectIn(dir).getPreEmitDiagnostics();

      expect(diagnostics).toEqual([]);
    });

    it('discovers the finite constructor field through init', async () => {
      const dir = writeFixture(language, true);
      await run(['init', '--yes'], captureIo(dir).io);

      const fields = declarationIn(dir).lifecycles[0]?.fields;

      expect(fields?.map(({ name, terminal }) => ({ name, terminal }))).toEqual([{ name: 'closed', terminal: ['true'] }]);
    });

    it('writes a diagnostic-free generated config', async () => {
      const dir = writeFixture(language, true);
      await run(['init', '--yes'], captureIo(dir).io);

      const project = projectIn(dir);
      configSourceFile(project, join(dir, 'domain.config.ts'), dir);

      expect(project.getPreEmitDiagnostics()).toEqual([]);
    });

    it('checks the statically read generated config', async () => {
      const dir = writeFixture(language, true);
      await run(['init', '--yes'], captureIo(dir).io);

      expect(await checkJson(dir)).toEqual({ code: 0, findings: [] });
    });

    it('reports the exact unguarded rename finding with explicit static config', async () => {
      const dir = writeFixture(language, false, true);

      const result = await checkJson(dir);

      expect(result).toEqual({ code: 1, findings: [{ severity: 'error', ruleId: 'terminal-state-leak', aggregate: 'Ticket', method: 'rename', field: 'closed', values: ['true'] }] });
    });

    it('retains the exact guarded source set with explicit static config', () => {
      const dir = writeFixture(language, true, true);

      const method = extractedIn(dir).aggregates[0]?.methods.find(({ name }) => name === 'rename');

      expect(describeSources(method!.fields.get('closed')!.sources)).toEqual(['false']);
    });
  });
}

for (const runtimeUse of [
  "export const escaped = [Ticket].map(value => value);",
  "Object.defineProperty(Ticket.prototype, 'label', { get() { return ''; } });",
]) {
  const runtime = `import { Ticket } from './ticket.js'; ${runtimeUse}`;
  describe('included JavaScript runtime interference', () => {
    it('excludes the identical use when it occurs only in static config', async () => {
      const dir = writeFixture('js', false, true, { 'domain.config.ts': config('js') + runtimeUse });

      const result = await checkJson(dir);

      expect(result).toEqual({ code: 1, findings: [{ severity: 'error', ruleId: 'terminal-state-leak', aggregate: 'Ticket', method: 'rename', field: 'closed', values: ['true'] }] });
    });

    it('withholds constructor-only discovery', () => {
      const dir = writeFixture('js', false, false, { 'src/runtime.js': runtime });
      const project = projectIn(dir);

      const model = extractLifecycles({ files: project.getSourceFiles(), declaration: DEFAULT_DECLARATION, projectRoot: dir, repositoryRoot: dir });

      expect(model.aggregates[0]?.fields).toEqual([]);
    });

    it('keeps declared-field rename unknown', () => {
      const dir = writeFixture('js', false, true, { 'src/runtime.js': runtime });

      const method = extractedIn(dir).aggregates[0]?.methods.find(({ name }) => name === 'rename');

      expect(describeSources(method!.fields.get('closed')!.sources)).toBe('unknown');
    });
  });
}
