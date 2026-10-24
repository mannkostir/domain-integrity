import { describe, expect, it } from 'vitest';
import { addLifecycles, recordBaseClasses } from '../../src/cli/config-writer';
import { moduleSpecifiers } from '../../src/cli/module-specifier';
import { ConfigError } from '../../src/engine/errors';
import { inMemoryProject } from '../helpers/in-memory';

const NESTED_CONFIG = '/configs/my.config.ts';

const nestedConfigFile = (config: string) => inMemoryProject({ [NESTED_CONFIG]: config }).getSourceFileOrThrow(NESTED_CONFIG);

describe('recordBaseClasses', () => {
  it('names the config file by the given path when it lacks the defineDomain default export', () => {
    const file = nestedConfigFile('export default 42;\n');

    expect(() => recordBaseClasses(file, 'configs/my.config.ts', ['Model'], [])).toThrow(
      new ConfigError('configs/my.config.ts must "export default defineDomain({...})".'),
    );
  });

  it('names the config file by the given path when its aggregates option is not an object literal', () => {
    const file = nestedConfigFile("import { defineDomain } from 'domain-integrity';\nconst group = {};\nexport default defineDomain({ aggregates: group });\n");

    expect(() => recordBaseClasses(file, 'configs/my.config.ts', ['Model'], [])).toThrow(
      new ConfigError('"aggregates" in configs/my.config.ts must be an object literal.'),
    );
  });

  it('names the config file by the given path when its base classes are not an array literal', () => {
    const file = nestedConfigFile(
      "import { defineDomain } from 'domain-integrity';\nconst baseClasses = ['A'];\nexport default defineDomain({ aggregates: { baseClasses: baseClasses } });\n",
    );

    expect(() => recordBaseClasses(file, 'configs/my.config.ts', ['Model'], [])).toThrow(
      new ConfigError('"aggregates.baseClasses" in configs/my.config.ts must be an array literal.'),
    );
  });

  it('names the config file by the given path when its deprecated base classes are not an array literal', () => {
    const file = nestedConfigFile(
      "import { defineDomain } from 'domain-integrity';\nconst baseClasses = ['A'];\nexport default defineDomain({ aggregateBaseClasses: baseClasses });\n",
    );

    expect(() => recordBaseClasses(file, 'configs/my.config.ts', ['Model'], [])).toThrow(
      new ConfigError('"aggregateBaseClasses" in configs/my.config.ts must be an array literal.'),
    );
  });
});

describe('addLifecycles', () => {
  it('names the config file by the given path when it lacks the defineDomain default export', () => {
    const project = inMemoryProject({ [NESTED_CONFIG]: 'export default 42;\n' });

    expect(() => addLifecycles(project.getSourceFileOrThrow(NESTED_CONFIG), 'configs/my.config.ts', moduleSpecifiers(project), [])).toThrow(
      new ConfigError('configs/my.config.ts must "export default defineDomain({...})".'),
    );
  });

  it('names the config file by the given path when its lifecycles are not an array literal', () => {
    const config = "import { defineDomain } from 'domain-integrity';\nconst list = [];\nexport default defineDomain({ lifecycles: list });\n";
    const project = inMemoryProject({ [NESTED_CONFIG]: config });

    expect(() => addLifecycles(project.getSourceFileOrThrow(NESTED_CONFIG), 'configs/my.config.ts', moduleSpecifiers(project), [])).toThrow(
      new ConfigError('"lifecycles" in configs/my.config.ts must be an array literal.'),
    );
  });
});
