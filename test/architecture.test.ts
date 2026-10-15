import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint();

const restrictedImportsIn = async (filePath: string, code: string): Promise<number> => {
  const results = await eslint.lintText(code, { filePath });
  return results.flatMap((result) => result.messages).filter((message) => message.ruleId === 'no-restricted-imports').length;
};

describe('import boundaries', () => {
  it('forbids ts-morph in the public entry point', async () => {
    expect(await restrictedImportsIn('src/index.ts', "export { Project } from 'ts-morph';\n")).toBe(1);
  });

  it('forbids the public entry point from reaching past the config helpers', async () => {
    expect(await restrictedImportsIn('src/index.ts', "export { loadProject } from './engine/project';\n")).toBe(1);
  });

  it('allows the public entry point to export the config helpers', async () => {
    expect(await restrictedImportsIn('src/index.ts', "export { defineDomain } from './config/define';\n")).toBe(0);
  });

  it('forbids ts-morph in the config helpers', async () => {
    expect(await restrictedImportsIn('src/config/define.ts', "import { Project } from 'ts-morph';\nexport const p = Project;\n")).toBe(1);
  });

  it('forbids the config helpers from importing the rest of the package', async () => {
    expect(await restrictedImportsIn('src/config/define.ts', "import { analyse } from '../analyzer';\nexport const a = analyse;\n")).toBe(1);
  });

  it('forbids the engine from importing analyzers', async () => {
    expect(await restrictedImportsIn('src/engine/project.ts', "import { lifecycleAnalyzer } from '../analyzers/lifecycle/analyzer';\nexport const a = lifecycleAnalyzer;\n")).toBe(1);
  });

  it('forbids the engine from importing the cli', async () => {
    expect(await restrictedImportsIn('src/engine/project.ts', "import { main } from '../cli/main';\nexport const m = main;\n")).toBe(1);
  });

  it('forbids ts-morph in lifecycle checks', async () => {
    expect(await restrictedImportsIn('src/analyzers/lifecycle/checks/outside-mutation.ts', "import { Node } from 'ts-morph';\nexport const n = Node;\n")).toBe(1);
  });
});
