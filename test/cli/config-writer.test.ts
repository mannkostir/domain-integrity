import { describe, expect, it } from 'vitest';
import { addLifecycles, recordBaseClasses } from '../../src/cli/config-writer';
import { moduleSpecifiers } from '../../src/cli/module-specifier';
import { StateField, StateValue } from '../../src/analyzers/lifecycle/model';
import { FieldSuggestion, LifecycleSuggestion } from '../../src/analyzers/lifecycle/suggest';
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

const ORDER_SOURCE = `export enum OrderStatus { pending = 'PENDING', confirmed = 'CONFIRMED', cancelled = 'CANCELLED' }
export class Order {}
`;

const ORDER_FILE = '/src/order.ts';

const CONFIG_FILE = '/domain.config.ts';

const EMPTY_CONFIG = "import { defineDomain } from 'domain-integrity';\n\nexport default defineDomain({\n  lifecycles: [],\n});\n";

const enumValue = (member: string): StateValue => ({
  token: member.toUpperCase(),
  label: member,
  source: { kind: 'expression', text: `OrderStatus.${member}` },
});

const stringValue = (value: string): StateValue => ({ token: value, label: value, source: { kind: 'string', value } });

const PENDING = enumValue('pending');
const CONFIRMED = enumValue('confirmed');
const CANCELLED = enumValue('cancelled');

const enumStatus: StateField = {
  name: 'status',
  kind: 'enum',
  values: [PENDING, CONFIRMED, CANCELLED],
  enumReference: { name: 'OrderStatus', file: ORDER_FILE },
  unsetForms: [],
  setMayBeFalsy: false,
};

const OPEN = stringValue('open');
const CLOSED = stringValue('closed');

const unionState: StateField = {
  name: 'state',
  kind: 'union',
  values: [OPEN, CLOSED],
  enumReference: undefined,
  unsetForms: [],
  setMayBeFalsy: false,
};

const SEEDED_STATUS: FieldSuggestion = {
  field: enumStatus,
  terminal: [CANCELLED],
  transitions: {
    kind: 'seeded',
    entries: [
      { method: 'confirm', from: [PENDING] },
      { method: 'cancel', from: [PENDING, CONFIRMED] },
      { method: 'reopen', from: [] },
    ],
  },
};

const SEEDED_STATE: FieldSuggestion = {
  field: unionState,
  terminal: [CLOSED],
  transitions: { kind: 'seeded', entries: [{ method: 'close', from: [OPEN] }] },
};

const orderSuggestion = (fields: readonly FieldSuggestion[]): LifecycleSuggestion => ({ className: 'Order', file: ORDER_FILE, fields });

const writtenConfig = (config: string, fields: readonly FieldSuggestion[]): string => {
  const project = inMemoryProject({ [ORDER_FILE]: ORDER_SOURCE, [CONFIG_FILE]: config });
  const file = project.getSourceFileOrThrow(CONFIG_FILE);
  addLifecycles(file, 'domain.config.ts', moduleSpecifiers(project), [orderSuggestion(fields)]);
  return file.getFullText();
};

const linesOf = (...lines: readonly string[]): string => `${lines.join('\n')}\n`;

describe('addLifecycles with private state fields', () => {
  it('quotes the name of a field with seeded transitions', () => {
    const config = writtenConfig(EMPTY_CONFIG, [{ ...SEEDED_STATE, field: { ...unionState, name: '#state' } }]);

    expect(config).toContain("        '#state': {\n");
  });

  it('quotes the name of a field without seeded transitions', () => {
    const config = writtenConfig(EMPTY_CONFIG, [{ ...SEEDED_STATE, field: { ...unionState, name: '#state' }, transitions: { kind: 'none' } }]);

    expect(config).toContain("        '#state': { terminal: 'closed' },\n");
  });

  it('uses the existing double quotes for a private field name', () => {
    const config = writtenConfig(EMPTY_CONFIG.replace(/'/g, '"'), [{ ...SEEDED_STATE, field: { ...unionState, name: '#state' } }]);

    expect(config).toContain('        "#state": {\n');
  });
});

describe('addLifecycles with seeded transitions', () => {
  it('writes a seeded field over several lines with its transitions', () => {
    const config = writtenConfig(EMPTY_CONFIG, [SEEDED_STATUS]);

    expect(config).toBe(
      linesOf(
        "import { defineDomain, lifecycle } from 'domain-integrity';",
        "import { Order, OrderStatus } from './src/order';",
        '',
        'export default defineDomain({',
        '  lifecycles: [',
        '    lifecycle(Order, {',
        '      states: {',
        '        status: {',
        '          terminal: OrderStatus.cancelled,',
        '          transitions: {',
        '            confirm: { from: [OrderStatus.pending] },',
        '            cancel: { from: [OrderStatus.pending, OrderStatus.confirmed] },',
        '            reopen: { from: [] },',
        '          },',
        '        },',
        '      },',
        '    }),',
        '  ],',
        '});',
      ),
    );
  });

  it('writes several terminal values of a seeded field as an array', () => {
    const config = writtenConfig(EMPTY_CONFIG, [{ ...SEEDED_STATUS, terminal: [CONFIRMED, CANCELLED] }]);

    expect(config).toContain('          terminal: [OrderStatus.confirmed, OrderStatus.cancelled],\n');
  });

  it('writes no terminal value of a seeded field as an empty array', () => {
    const config = writtenConfig(EMPTY_CONFIG, [{ ...SEEDED_STATUS, terminal: [] }]);

    expect(config).toContain('          terminal: [],\n');
  });

  it('renames the enum in transition sources when its name is taken by a type-only import', () => {
    const config = writtenConfig(
      "import { defineDomain } from 'domain-integrity';\nimport type { OrderStatus } from './src/order';\n\nexport default defineDomain({\n  lifecycles: [],\n});\n",
      [{ ...SEEDED_STATUS, terminal: [] }],
    );

    expect(config).toContain(
      "import { Order, OrderStatus as OrderStatus2 } from './src/order';\n\nexport default defineDomain({\n  lifecycles: [\n    lifecycle(Order, {\n      states: {\n        status: {\n          terminal: [],\n          transitions: {\n            confirm: { from: [OrderStatus2.pending] },\n            cancel: { from: [OrderStatus2.pending, OrderStatus2.confirmed] },\n",
    );
  });

  it('imports the enum for transition sources alone', () => {
    const config = writtenConfig(EMPTY_CONFIG, [{ ...SEEDED_STATUS, terminal: [] }]);

    expect(config).toContain("import { Order, OrderStatus } from './src/order';\n");
  });

  it('imports only the aggregate when every transition source is empty and no terminal value is written', () => {
    const config = writtenConfig(EMPTY_CONFIG, [
      { ...SEEDED_STATUS, terminal: [], transitions: { kind: 'seeded', entries: [{ method: 'reopen', from: [] }] } },
    ]);

    expect(config).toContain("import { Order } from './src/order';\n");
  });

  it('writes string transition sources in the double quotes of the config', () => {
    const config = writtenConfig(EMPTY_CONFIG.replace("'domain-integrity'", '"domain-integrity"'), [SEEDED_STATE]);

    expect(config).toContain('        state: {\n          terminal: "closed",\n          transitions: {\n            close: { from: ["open"] },\n          },\n        },\n');
  });

  it('writes string transition sources in the single quotes of the config', () => {
    const config = writtenConfig(EMPTY_CONFIG, [SEEDED_STATE]);

    expect(config).toContain("            close: { from: ['open'] },\n");
  });

  it('indents a seeded field with the tabs of the config', () => {
    const config = writtenConfig(EMPTY_CONFIG.replace('  lifecycles', '\tlifecycles'), [SEEDED_STATE]);

    expect(config).toContain("\t\t\t\tstate: {\n\t\t\t\t\tterminal: 'closed',\n\t\t\t\t\ttransitions: {\n\t\t\t\t\t\tclose: { from: ['open'] },\n\t\t\t\t\t},\n\t\t\t\t},\n");
  });

  it('writes a seeded field with the CRLF line endings of the config', () => {
    const config = writtenConfig(EMPTY_CONFIG.replace(/\n/g, '\r\n'), [SEEDED_STATE]);

    expect(config).toContain("      states: {\r\n        state: {\r\n          terminal: 'closed',\r\n          transitions: {\r\n            close: { from: ['open'] },\r\n          },\r\n        },\r\n      },\r\n");
  });

  it('keeps a field without seeded transitions on one line', () => {
    const config = writtenConfig(EMPTY_CONFIG, [
      { ...SEEDED_STATE, transitions: { kind: 'withheld', methods: [{ method: 'close', reason: 'unknown-sources' }] } },
      { ...SEEDED_STATUS, transitions: { kind: 'none' } },
    ]);

    expect(config).toContain("      states: {\n        state: { terminal: 'closed' },\n        status: { terminal: OrderStatus.cancelled },\n      },\n");
  });
});
