import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli/run';
import { TICKET_SOURCES, captureIo, writeProject } from '../helpers/disk';
import { AGGREGATE_ROOT } from '../helpers/in-memory';
import { declarationIn, initWithBaseClass, readConfig } from '../helpers/init-project';
import { FOUR_SPACE_CONFIG, INVITATION, PAYMENT, SWITCH } from '../helpers/init-sources';

const LIGHT = `
import { AggregateRoot } from './aggregate-root';
export enum LightState { off = 'OFF', on = 'ON' }
export class Light extends AggregateRoot<{ state: LightState }> {
  static off(): Light { return new Light({ state: LightState.off }); }
  turnOn(): void { if (this.props.state === LightState.on) return; this.props.state = LightState.on; }
  turnOff(): void { if (this.props.state === LightState.off) return; this.props.state = LightState.off; }
}
`;

const NOTICE = `
import { AggregateRoot } from './aggregate-root';
export class Notice extends AggregateRoot<{ state: 'draft' | 'say "done"' }> {
  static draft(): Notice { return new Notice({ state: 'draft' }); }
  finish(): void { if (this.props.state === 'say "done"') return; this.props.state = 'say "done"'; }
}
`;

const noticeFinishingAs = (literal: string): string => `
import { AggregateRoot } from './aggregate-root';
export class Notice extends AggregateRoot<{ state: 'draft' | ${literal} }> {
  static draft(): Notice { return new Notice({ state: 'draft' }); }
  finish(): void { if (this.props.state === ${literal}) return; this.props.state = ${literal}; }
}
`;

const LEVEL = `
import { AggregateRoot } from './aggregate-root';
export class Level extends AggregateRoot<{ level: 1 | 2 }> {
  static start(): Level { return new Level({ level: 1 }); }
  finish(): void { if (this.props.level === 2) return; this.props.level = 2; }
}
`;

const TAB_CONFIG = `import { defineDomain } from 'domain-integrity';

export default defineDomain({
\tlifecycles: [],
});
`;

const withCrlf = (text: string): string => text.replace(/\n/g, '\r\n');

const textOf = (...lines: readonly string[]): string => `${lines.join('\n')}\n`;

type ConfigParts = { readonly imports: readonly string[]; readonly body: readonly string[] };

const configText = ({ imports, body }: ConfigParts): string => textOf(...imports, '', 'export default defineDomain({', ...body, '});');

const DEFINE_DOMAIN_IMPORT = "import { defineDomain } from 'domain-integrity';";

const TICKET_IMPORTS = ["import { defineDomain, lifecycle } from 'domain-integrity';", "import { Ticket, TicketStatus } from './src/ticket';"];

const TICKET_AND_PAYMENT_IMPORTS = [...TICKET_IMPORTS, "import { Payment } from './src/payment';"];

const SINGLE_LINE_LIFECYCLES_CONFIG = configText({
  imports: TICKET_IMPORTS,
  body: ['  lifecycles: [lifecycle(Ticket, { states: { status: { terminal: [TicketStatus.closed] } } }) /* reviewed */],'],
});

const MULTI_LINE_LIFECYCLES_CONFIG = configText({
  imports: TICKET_IMPORTS,
  body: [
    '  lifecycles: [',
    '    // reviewed by the support team',
    '    lifecycle(Ticket, { states: { status: { terminal: [TicketStatus.closed] } } })',
    '  ],',
  ],
});

const TRAILING_COMMENT_LIFECYCLES_CONFIG = configText({
  imports: TICKET_IMPORTS,
  body: ['  lifecycles: [lifecycle(Ticket, { states: { status: { terminal: [TicketStatus.closed] } } }), /* more to come */],'],
});

const PAYMENT_LIFECYCLE_LINES = [
  '    lifecycle(Payment, {',
  '      states: {',
  "        state: { terminal: 'paid' },",
  '      },',
  '    }),',
];

const TICKET_LIFECYCLE_LINES = [
  '    lifecycle(Ticket, {',
  '      states: {',
  '        status: { terminal: TicketStatus.closed },',
  '      },',
  '    }),',
];

const SPREAD_SINGLE_LINE_RESULT = configText({
  imports: TICKET_AND_PAYMENT_IMPORTS,
  body: [
    '  lifecycles: [',
    '    lifecycle(Ticket, { states: { status: { terminal: [TicketStatus.closed] } } }) /* reviewed */,',
    ...PAYMENT_LIFECYCLE_LINES,
    '  ],',
  ],
});

const APPENDED_MULTI_LINE_RESULT = configText({
  imports: TICKET_AND_PAYMENT_IMPORTS,
  body: [
    '  lifecycles: [',
    '    // reviewed by the support team',
    '    lifecycle(Ticket, { states: { status: { terminal: [TicketStatus.closed] } } }),',
    ...PAYMENT_LIFECYCLE_LINES,
    '  ],',
  ],
});

const BRACKET_AFTER_LAST_LIFECYCLE_CONFIG = configText({
  imports: TICKET_IMPORTS,
  body: ['  lifecycles: [lifecycle(Ticket, {', '    states: { status: { terminal: [TicketStatus.closed] } },', '  })],'],
});

const BRACKET_AFTER_LAST_LIFECYCLE_RESULT = configText({
  imports: TICKET_AND_PAYMENT_IMPORTS,
  body: ['  lifecycles: [lifecycle(Ticket, {', '    states: { status: { terminal: [TicketStatus.closed] } },', '  }),', ...PAYMENT_LIFECYCLE_LINES, '  ],'],
});

const DOUBLE_QUOTED_CONFIG = configText({ imports: ['import { defineDomain } from "domain-integrity";'], body: ['  lifecycles: [],'] });

const SINGLE_LINE_TICKET_LIFECYCLES = '  lifecycles: [lifecycle(Ticket, { states: { status: { terminal: [TicketStatus.closed] } } })],';

const DOUBLE_QUOTED_LIFECYCLE_IMPORT = 'import { defineDomain, lifecycle } from "domain-integrity";';

const SINGLE_QUOTED_CONFIG = configText({ imports: [DEFINE_DOMAIN_IMPORT], body: ['  lifecycles: [],'] });

const initIn = async (files: Readonly<Record<string, string>>): Promise<string> => {
  const dir = writeProject(files);
  await run(['init', '--yes'], captureIo(dir).io);
  return readConfig(dir);
};

describe('init config layout', () => {
  it('writes a single terminal value of a new config as a scalar on its own line', async () => {
    const config = await initIn(TICKET_SOURCES);

    expect(config).toBe(`import { defineDomain, lifecycle } from 'domain-integrity';
import { Ticket, TicketStatus } from './src/ticket';

export default defineDomain({
  lifecycles: [
    lifecycle(Ticket, {
      states: {
        status: { terminal: TicketStatus.closed },
      },
    }),
  ],
});
`);
  });

  it('writes several terminal values as an array', async () => {
    const config = await initIn({ 'src/aggregate-root.ts': AGGREGATE_ROOT, 'src/invitation.ts': INVITATION });

    expect(config).toBe(`import { defineDomain, lifecycle } from 'domain-integrity';
import { Invitation } from './src/invitation';

export default defineDomain({
  lifecycles: [
    lifecycle(Invitation, {
      states: {
        state: { terminal: ['accepted', 'rejected'] },
      },
    }),
  ],
});
`);
  });

  it('writes a field without terminal values as an empty array', async () => {
    const config = await initIn({ 'src/aggregate-root.ts': AGGREGATE_ROOT, 'src/switch.ts': SWITCH });

    expect(config).toBe(`import { defineDomain, lifecycle } from 'domain-integrity';
import { Switch } from './src/switch';

export default defineDomain({
  lifecycles: [
    lifecycle(Switch, {
      states: {
        state: { terminal: [] },
      },
    }),
  ],
});
`);
  });

  it('imports only the aggregate when an enum field gets no terminal values', async () => {
    const config = await initIn({ 'src/aggregate-root.ts': AGGREGATE_ROOT, 'src/light.ts': LIGHT });

    expect(config).toContain("import { defineDomain, lifecycle } from 'domain-integrity';\nimport { Light } from './src/light';\n\n");
  });

  it('nests with four spaces in a four-space config', async () => {
    const config = await initIn({ ...TICKET_SOURCES, 'domain.config.ts': FOUR_SPACE_CONFIG });

    expect(config).toBe(`import { defineDomain, lifecycle } from 'domain-integrity';
import { Ticket, TicketStatus } from './src/ticket';

export default defineDomain({
    lifecycles: [
        lifecycle(Ticket, {
            states: {
                status: { terminal: TicketStatus.closed },
            },
        }),
    ],
});
`);
  });

  it('nests with tabs in a tab-indented config', async () => {
    const config = await initIn({ ...TICKET_SOURCES, 'domain.config.ts': TAB_CONFIG });

    expect(config).toBe(`import { defineDomain, lifecycle } from 'domain-integrity';
import { Ticket, TicketStatus } from './src/ticket';

export default defineDomain({
\tlifecycles: [
\t\tlifecycle(Ticket, {
\t\t\tstates: {
\t\t\t\tstatus: { terminal: TicketStatus.closed },
\t\t\t},
\t\t}),
\t],
});
`);
  });

  it('falls back to nesting with two spaces in a config indented with three spaces', async () => {
    const config = await initIn({ ...TICKET_SOURCES, 'domain.config.ts': configText({ imports: [DEFINE_DOMAIN_IMPORT], body: ['   lifecycles: [],'] }) });

    expect(config).toBe(`import { defineDomain, lifecycle } from 'domain-integrity';
import { Ticket, TicketStatus } from './src/ticket';

export default defineDomain({
   lifecycles: [
     lifecycle(Ticket, {
       states: {
         status: { terminal: TicketStatus.closed },
       },
     }),
   ],
});
`);
  });

  it('spreads a single-line lifecycles array over lines and keeps the existing element text', async () => {
    const config = await initIn({ ...TICKET_SOURCES, 'src/payment.ts': PAYMENT, 'domain.config.ts': SINGLE_LINE_LIFECYCLES_CONFIG });

    expect(config).toBe(SPREAD_SINGLE_LINE_RESULT);
  });

  it('keeps a comment after the trailing comma of a single-line lifecycles array', async () => {
    const config = await initIn({ ...TICKET_SOURCES, 'src/payment.ts': PAYMENT, 'domain.config.ts': TRAILING_COMMENT_LIFECYCLES_CONFIG });

    expect(config).toBe(
      configText({
        imports: TICKET_AND_PAYMENT_IMPORTS,
        body: [
          '  lifecycles: [',
          '    lifecycle(Ticket, { states: { status: { terminal: [TicketStatus.closed] } } }),',
          '    /* more to come */',
          ...PAYMENT_LIFECYCLE_LINES,
          '  ],',
        ],
      }),
    );
  });

  it('appends to a multi-line lifecycles array and keeps its comment', async () => {
    const config = await initIn({ ...TICKET_SOURCES, 'src/payment.ts': PAYMENT, 'domain.config.ts': MULTI_LINE_LIFECYCLES_CONFIG });

    expect(config).toBe(APPENDED_MULTI_LINE_RESULT);
  });
});

describe('init config layout of an existing config', () => {
  it('keeps CRLF line endings when spreading a single-line lifecycles array', async () => {
    const config = await initIn({ ...TICKET_SOURCES, 'src/payment.ts': PAYMENT, 'domain.config.ts': withCrlf(SINGLE_LINE_LIFECYCLES_CONFIG) });

    expect(config).toBe(withCrlf(SPREAD_SINGLE_LINE_RESULT));
  });

  it('keeps CRLF line endings when appending to a multi-line lifecycles array', async () => {
    const config = await initIn({ ...TICKET_SOURCES, 'src/payment.ts': PAYMENT, 'domain.config.ts': withCrlf(MULTI_LINE_LIFECYCLES_CONFIG) });

    expect(config).toBe(withCrlf(APPENDED_MULTI_LINE_RESULT));
  });

  it('keeps the text of a multi-line lifecycle in a CRLF config', async () => {
    const config = await initIn({ ...TICKET_SOURCES, 'src/payment.ts': PAYMENT, 'domain.config.ts': withCrlf(BRACKET_AFTER_LAST_LIFECYCLE_CONFIG) });

    expect(config).toBe(withCrlf(BRACKET_AFTER_LAST_LIFECYCLE_RESULT));
  });

  it('keeps CRLF line endings when recording a base class', async () => {
    const withLf = await initWithBaseClass(FOUR_SPACE_CONFIG);
    const withCrLf = await initWithBaseClass(withCrlf(FOUR_SPACE_CONFIG));

    expect(readConfig(withCrLf)).toBe(withCrlf(readConfig(withLf)));
  });

  it('writes new imports and terminal values in the double quotes of the config', async () => {
    const config = await initIn({ 'src/aggregate-root.ts': AGGREGATE_ROOT, 'src/payment.ts': PAYMENT, 'domain.config.ts': DOUBLE_QUOTED_CONFIG });

    expect(config).toBe(
      configText({
        imports: [DOUBLE_QUOTED_LIFECYCLE_IMPORT, 'import { Payment } from "./src/payment";'],
        body: [
          '  lifecycles: [',
          '    lifecycle(Payment, {',
          '      states: {',
          '        state: { terminal: "paid" },',
          '      },',
          '    }),',
          '  ],',
        ],
      }),
    );
  });

  it('writes recorded base classes in the double quotes of the config', async () => {
    const dir = await initWithBaseClass(DOUBLE_QUOTED_CONFIG);

    expect(readConfig(dir)).toBe(
      configText({
        imports: [DOUBLE_QUOTED_LIFECYCLE_IMPORT, 'import { Invoice } from "./src/invoice";'],
        body: [
          '  aggregates: { baseClasses: ["AggregateRoot", "Entity", "Model"] },',
          '  lifecycles: [',
          '    lifecycle(Invoice, {',
          '      states: {',
          '        state: { terminal: "void" },',
          '      },',
          '    }),',
          '  ],',
        ],
      }),
    );
  });

  it('escapes a double quote inside a terminal value written in double quotes', async () => {
    const config = await initIn({ 'src/aggregate-root.ts': AGGREGATE_ROOT, 'src/notice.ts': NOTICE, 'domain.config.ts': DOUBLE_QUOTED_CONFIG });

    expect(config).toBe(
      configText({
        imports: [DOUBLE_QUOTED_LIFECYCLE_IMPORT, 'import { Notice } from "./src/notice";'],
        body: [
          '  lifecycles: [',
          '    lifecycle(Notice, {',
          '      states: {',
          '        state: { terminal: "say \\"done\\"" },',
          '      },',
          '    }),',
          '  ],',
        ],
      }),
    );
  });

  it('escapes a single quote inside a terminal value written in single quotes', async () => {
    const config = await initIn({ 'src/aggregate-root.ts': AGGREGATE_ROOT, 'src/notice.ts': NOTICE.replace(/say "done"/g, `it\\'s "done"`) });

    expect(config).toContain(`state: { terminal: 'it\\'s "done"' },`);
  });

  it('writes a config with an escaped terminal value that check reads', async () => {
    const dir = writeProject({ 'src/aggregate-root.ts': AGGREGATE_ROOT, 'src/notice.ts': NOTICE, 'domain.config.ts': DOUBLE_QUOTED_CONFIG });
    await run(['init', '--yes'], captureIo(dir).io);

    expect(await run(['check'], captureIo(dir).io)).toBe(0);
  });

  it('writes an escaped terminal value that reads back as the value of the state', async () => {
    const dir = writeProject({ 'src/aggregate-root.ts': AGGREGATE_ROOT, 'src/notice.ts': NOTICE, 'domain.config.ts': DOUBLE_QUOTED_CONFIG });
    await run(['init', '--yes'], captureIo(dir).io);

    expect(declarationIn(dir).lifecycles[0]?.fields[0]?.terminal).toEqual(['say "done"']);
  });

  it.each([
    ['a backslash', 'single-quoted', '"it\'s\\\\done"', "it's\\done", SINGLE_QUOTED_CONFIG],
    ['a backslash', 'double-quoted', '"it\'s\\\\done"', "it's\\done", DOUBLE_QUOTED_CONFIG],
    ['a line break', 'single-quoted', "'line\\nbreak'", 'line\nbreak', SINGLE_QUOTED_CONFIG],
    ['a line break', 'double-quoted', "'line\\nbreak'", 'line\nbreak', DOUBLE_QUOTED_CONFIG],
  ])('writes a terminal value with %s that reads back as the value of the state in a %s config', async (_, __, literal, value, config) => {
    const dir = writeProject({ 'src/aggregate-root.ts': AGGREGATE_ROOT, 'src/notice.ts': noticeFinishingAs(literal), 'domain.config.ts': config });
    await run(['init', '--yes'], captureIo(dir).io);

    expect(declarationIn(dir).lifecycles[0]?.fields[0]?.terminal).toEqual([value]);
  });

  it.each([
    ['a backslash', 'single-quoted', '"it\'s\\\\done"', SINGLE_QUOTED_CONFIG],
    ['a backslash', 'double-quoted', '"it\'s\\\\done"', DOUBLE_QUOTED_CONFIG],
    ['a line break', 'single-quoted', "'line\\nbreak'", SINGLE_QUOTED_CONFIG],
    ['a line break', 'double-quoted', "'line\\nbreak'", DOUBLE_QUOTED_CONFIG],
  ])('writes a terminal value with %s that check reads in a %s config', async (_, __, literal, config) => {
    const dir = writeProject({ 'src/aggregate-root.ts': AGGREGATE_ROOT, 'src/notice.ts': noticeFinishingAs(literal), 'domain.config.ts': config });
    await run(['init', '--yes'], captureIo(dir).io);

    expect(await run(['check'], captureIo(dir).io)).toBe(0);
  });

  it('writes a numeric terminal value unquoted', async () => {
    const config = await initIn({ 'src/aggregate-root.ts': AGGREGATE_ROOT, 'src/level.ts': LEVEL, 'domain.config.ts': DOUBLE_QUOTED_CONFIG });

    expect(config).toContain('        level: { terminal: 2 },\n');
  });

  it('nests relative to the line of a config object that opens on its own line', async () => {
    const config = await initIn({
      ...TICKET_SOURCES,
      'domain.config.ts': textOf(DEFINE_DOMAIN_IMPORT, '', 'export default defineDomain(', '  {', '    lifecycles: [],', '  },', ');'),
    });

    expect(config).toBe(
      textOf(
        ...TICKET_IMPORTS,
        '',
        'export default defineDomain(',
        '  {',
        '    lifecycles: [',
        '      lifecycle(Ticket, {',
        '        states: {',
        '          status: { terminal: TicketStatus.closed },',
        '        },',
        '      }),',
        '    ],',
        '  },',
        ');',
      ),
    );
  });

  it('writes in the quotes most imports use when the first import uses the other kind', async () => {
    const config = await initIn({
      ...TICKET_SOURCES,
      'src/payment.ts': PAYMENT,
      'domain.config.ts': configText({
        imports: [
          "import { defineDomain, lifecycle } from 'domain-integrity';",
          'import { Ticket } from "./src/ticket";',
          'import { TicketStatus } from "./src/ticket";',
        ],
        body: [SINGLE_LINE_TICKET_LIFECYCLES],
      }),
    });

    expect(config).toContain('import { Payment } from "./src/payment";');
  });

  it('writes in the quotes of the imports when a single-quoted directive comes first', async () => {
    const config = await initIn({
      ...TICKET_SOURCES,
      'src/payment.ts': PAYMENT,
      'domain.config.ts': configText({
        imports: ["'use strict';", DOUBLE_QUOTED_LIFECYCLE_IMPORT, 'import { Ticket, TicketStatus } from "./src/ticket";'],
        body: [SINGLE_LINE_TICKET_LIFECYCLES],
      }),
    });

    expect(config).toContain('import { Payment } from "./src/payment";');
  });

  it('keeps LF line endings in a config whose last line alone ends in CRLF', async () => {
    const config = await initIn({
      ...TICKET_SOURCES,
      'src/payment.ts': PAYMENT,
      'domain.config.ts': MULTI_LINE_LIFECYCLES_CONFIG.replace(/\n$/, '\r\n'),
    });

    expect(config).toBe(APPENDED_MULTI_LINE_RESULT.replace(/\n$/, '\r\n'));
  });

  it('appends to a lifecycles array whose key is quoted', async () => {
    const config = await initIn({
      ...TICKET_SOURCES,
      'domain.config.ts': configText({ imports: [DEFINE_DOMAIN_IMPORT], body: ["  'lifecycles': [],"] }),
    });

    expect(config).toBe(configText({ imports: TICKET_IMPORTS, body: ["  'lifecycles': [", ...TICKET_LIFECYCLE_LINES, '  ],'] }));
  });

  it('puts new lifecycles after a comment that shares the line of the closing bracket', async () => {
    const config = await initIn({
      ...TICKET_SOURCES,
      'src/payment.ts': PAYMENT,
      'domain.config.ts': configText({
        imports: TICKET_IMPORTS,
        body: ['  lifecycles: [', '    lifecycle(Ticket, { states: { status: { terminal: [TicketStatus.closed] } } }),', '  /* end */ ],'],
      }),
    });

    expect(config).toBe(
      configText({
        imports: TICKET_AND_PAYMENT_IMPORTS,
        body: [
          '  lifecycles: [',
          '    lifecycle(Ticket, { states: { status: { terminal: [TicketStatus.closed] } } }),',
          '  /* end */',
          ...PAYMENT_LIFECYCLE_LINES,
          '  ],',
        ],
      }),
    );
  });

  it('puts the closing bracket on its own line when it followed the last lifecycle', async () => {
    const config = await initIn({ ...TICKET_SOURCES, 'src/payment.ts': PAYMENT, 'domain.config.ts': BRACKET_AFTER_LAST_LIFECYCLE_CONFIG });

    expect(config).toBe(BRACKET_AFTER_LAST_LIFECYCLE_RESULT);
  });

  it('appends to a multi-line lifecycles array that already ends in a trailing comma', async () => {
    const config = await initIn({
      ...TICKET_SOURCES,
      'src/payment.ts': PAYMENT,
      'domain.config.ts': configText({
        imports: TICKET_IMPORTS,
        body: ['  lifecycles: [', '    lifecycle(Ticket, { states: { status: { terminal: [TicketStatus.closed] } } }),', '  ],'],
      }),
    });

    expect(config).toBe(
      configText({
        imports: TICKET_AND_PAYMENT_IMPORTS,
        body: ['  lifecycles: [', '    lifecycle(Ticket, { states: { status: { terminal: [TicketStatus.closed] } } }),', ...PAYMENT_LIFECYCLE_LINES, '  ],'],
      }),
    );
  });

  it('fills an empty multi-line lifecycles array', async () => {
    const config = await initIn({
      ...TICKET_SOURCES,
      'domain.config.ts': configText({ imports: [DEFINE_DOMAIN_IMPORT], body: ['  lifecycles: [', '  ],'] }),
    });

    expect(config).toBe(configText({ imports: TICKET_IMPORTS, body: ['  lifecycles: [', ...TICKET_LIFECYCLE_LINES, '  ],'] }));
  });

  it('adds a lifecycles property to a config that has none', async () => {
    const config = await initIn({
      ...TICKET_SOURCES,
      'domain.config.ts': configText({ imports: [DEFINE_DOMAIN_IMPORT], body: ["  aggregates: { auditFields: ['stamp'] },"] }),
    });

    expect(config).toBe(configText({ imports: TICKET_IMPORTS, body: ["  aggregates: { auditFields: ['stamp'] },", '  lifecycles: [', ...TICKET_LIFECYCLE_LINES, '  ]'] }));
  });

  it('nests relative to the line of a lifecycles property that does not start it', async () => {
    const config = await initIn({
      ...TICKET_SOURCES,
      'domain.config.ts': configText({ imports: [DEFINE_DOMAIN_IMPORT], body: ["  aggregates: { auditFields: ['stamp'] }, lifecycles: [],"] }),
    });

    expect(config).toBe(configText({ imports: TICKET_IMPORTS, body: ["  aggregates: { auditFields: ['stamp'] }, lifecycles: [", ...TICKET_LIFECYCLE_LINES, '  ],'] }));
  });

  it('nests with two spaces when the config does not show its indentation', async () => {
    const config = await initIn({
      ...TICKET_SOURCES,
      'domain.config.ts': textOf(DEFINE_DOMAIN_IMPORT, 'export default defineDomain({ lifecycles: [] });'),
    });

    expect(config).toBe(
      textOf(
        ...TICKET_IMPORTS,
        '',
        'export default defineDomain({ lifecycles: [',
        '  lifecycle(Ticket, {',
        '    states: {',
        '      status: { terminal: TicketStatus.closed },',
        '    },',
        '  }),',
        '] });',
      ),
    );
  });

  it('nests with two spaces when the first property shares an indented line with the opening brace', async () => {
    const config = await initIn({
      ...TICKET_SOURCES,
      'domain.config.ts': textOf(DEFINE_DOMAIN_IMPORT, '', 'export default defineDomain(', '    { lifecycles: [] },', ');'),
    });

    expect(config).toBe(
      textOf(
        ...TICKET_IMPORTS,
        '',
        'export default defineDomain(',
        '    { lifecycles: [',
        '      lifecycle(Ticket, {',
        '        states: {',
        '          status: { terminal: TicketStatus.closed },',
        '        },',
        '      }),',
        '    ] },',
        ');',
      ),
    );
  });
});
