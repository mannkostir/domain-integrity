import { describe, expect, it } from 'vitest';
import { addLifecycles, recordBaseClasses } from '../../src/cli/config-writer';
import { moduleSpecifiers } from '../../src/cli/module-specifier';
import { ConfigError } from '../../src/engine/errors';
import { inMemoryProject } from '../helpers/in-memory';

describe('recordBaseClasses', () => {
  it('names the config file when it lacks the defineDomain default export', () => {
    const file = inMemoryProject({ '/configs/my.config.ts': 'export default 42;\n' }).getSourceFileOrThrow('/configs/my.config.ts');

    expect(() => recordBaseClasses(file, ['Model'], [])).toThrow(new ConfigError('my.config.ts must "export default defineDomain({...})".'));
  });

  it('names the config file when its aggregates option is not an object literal', () => {
    const config = "import { defineDomain } from 'domain-integrity';\nconst group = {};\nexport default defineDomain({ aggregates: group });\n";
    const file = inMemoryProject({ '/my.config.ts': config }).getSourceFileOrThrow('/my.config.ts');

    expect(() => recordBaseClasses(file, ['Model'], [])).toThrow(new ConfigError('"aggregates" in my.config.ts must be an object literal.'));
  });

  it('names the config file when its base classes are not an array literal', () => {
    const config = "import { defineDomain } from 'domain-integrity';\nconst baseClasses = ['A'];\nexport default defineDomain({ aggregates: { baseClasses: baseClasses } });\n";
    const file = inMemoryProject({ '/my.config.ts': config }).getSourceFileOrThrow('/my.config.ts');

    expect(() => recordBaseClasses(file, ['Model'], [])).toThrow(new ConfigError('"aggregates.baseClasses" in my.config.ts must be an array literal.'));
  });
});

describe('addLifecycles', () => {
  it('names the config file when its lifecycles are not an array literal', () => {
    const config = "import { defineDomain } from 'domain-integrity';\nconst list = [];\nexport default defineDomain({ lifecycles: list });\n";
    const project = inMemoryProject({ '/my.config.ts': config });

    expect(() => addLifecycles(project.getSourceFileOrThrow('/my.config.ts'), moduleSpecifiers(project), [])).toThrow(
      new ConfigError('"lifecycles" in my.config.ts must be an array literal.'),
    );
  });
});
