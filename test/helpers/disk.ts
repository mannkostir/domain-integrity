import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Io } from '../../src/cli/io';
import { AGGREGATE_ROOT } from './in-memory';

const HELPERS_ENTRY = fileURLToPath(new URL('../../src/index.ts', import.meta.url));

export const TICKET_SOURCES = {
  'src/aggregate-root.ts': AGGREGATE_ROOT,
  'src/ticket.ts': `
import { AggregateRoot } from './aggregate-root';
export enum TicketStatus { open = 'OPEN', closed = 'CLOSED' }
export class Ticket extends AggregateRoot<{ status: TicketStatus; title: string }> {
  static open(title: string): Ticket { return new Ticket({ status: TicketStatus.open, title }); }
  rename(title: string): void { this.props.title = title; }
  close(): void { if (this.props.status === TicketStatus.closed) return; this.props.status = TicketStatus.closed; }
}
`,
};

export const TICKET_CONFIG = `
import { defineDomain, lifecycle } from 'domain-integrity';
import { Ticket, TicketStatus } from './src/ticket';
export default defineDomain({ lifecycles: [lifecycle(Ticket, { states: { status: { terminal: [TicketStatus.closed] } } })] });
`;

export const TICKET_PROJECT = { ...TICKET_SOURCES, 'domain.config.ts': TICKET_CONFIG };

export const EVENT_FLOW_SOURCES = {
  'src/decorators.ts': 'export const EventsHandler = (...events: unknown[]) => (target: unknown) => target;\nexport const Saga = () => (target: unknown, key: string) => undefined;\nexport const ofType = (...types: unknown[]) => types;\nexport type Stream = { pipe: (...operators: unknown[]) => unknown };\n',
  'src/events.ts': 'export class Paid {}\nexport class Refunded {}\n',
  'src/pay.ts': "import { Paid } from './events';\nexport const pay = () => new Paid();\n",
  'src/handlers.ts': "import { EventsHandler } from './decorators';\nimport { Paid, Refunded } from './events';\n@EventsHandler(Paid) export class PaidHandler { handle(event: Paid) { return event; } }\n@EventsHandler(Refunded) export class RefundHandler { handle(event: Refunded) { return event; } }\n",
};

export const EVENT_FLOW_PROJECT = {
  ...EVENT_FLOW_SOURCES,
  'domain.config.ts': "import { defineDomain } from 'domain-integrity';\nexport default defineDomain({});\n",
};

export const writeProject = (files: Readonly<Record<string, string>>): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'domain-integrity-cli-')));
  const tsconfig = {
    compilerOptions: {
      strict: true,
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      paths: { 'domain-integrity': [HELPERS_ENTRY] },
    },
    include: ['src'],
  };
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify(tsconfig));
  Object.entries(files).forEach(([path, text]) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  });
  return dir;
};

export const captureIo = (cwd: string, answers: readonly boolean[] = []) => {
  const out: string[] = [];
  const err: string[] = [];
  const pending = [...answers];
  const io: Io = {
    cwd,
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    prompt: async () => pending.shift() ?? true,
    isInteractive: answers.length > 0,
  };
  return { io, stdout: () => out.join(''), stderr: () => err.join('') };
};
