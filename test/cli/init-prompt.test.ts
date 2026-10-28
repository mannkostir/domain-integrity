import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli/run';
import { terminalPrompt } from '../../src/cli/terminal-prompt';
import { TICKET_SOURCES, captureIo, writeProject } from '../helpers/disk';
import { AGGREGATE_ROOT } from '../helpers/in-memory';
import { readConfig } from '../helpers/init-project';
import { INVITATION, SWITCH, orderWithEnumIn } from '../helpers/init-sources';

const INVITATION_SOURCES = { 'src/aggregate-root.ts': AGGREGATE_ROOT, 'src/invitation.ts': INVITATION };

const PARCEL_SOURCES = {
  'src/aggregate-root.ts': AGGREGATE_ROOT,
  'src/parcel.ts': `
import { AggregateRoot } from './aggregate-root';
export class Parcel extends AggregateRoot<{ state: 'packed' | 'sent'; label: 'blank' | 'printed' }> {
  static pack(): Parcel { return new Parcel({ state: 'packed', label: 'blank' }); }
  send(): void { if (this.props.state === 'sent') return; this.props.state = 'sent'; }
  print(): void { if (this.props.label === 'printed') return; this.props.label = 'printed'; }
}
`,
};

const TICKET_CLOSED_BY_QUOTED_METHOD = {
  ...TICKET_SOURCES,
  'src/ticket.ts': TICKET_SOURCES['src/ticket.ts'].replace('  close(): void', "  'close now'(): void"),
};

const SEPARATED = `
import { AggregateRoot } from './aggregate-root';
export class Separated extends AggregateRoot<{ state: 'open' | 'a,b' | 'c' }> {
  static open(): Separated { return new Separated({ state: 'open' }); }
  finish(): void { if (this.props.state === 'c') return; this.props.state = 'c'; }
}
`;

const SEPARATED_SOURCES = { 'src/aggregate-root.ts': AGGREGATE_ROOT, 'src/separated.ts': SEPARATED };

const ORDER_SOURCES = {
  'src/aggregate-root.ts': AGGREGATE_ROOT,
  'src/order.ts': `
import { AggregateRoot } from './aggregate-root';
export class Order extends AggregateRoot<{ state: 'pending' | 'confirmed' | 'shipped' | 'cancelled' }> {
  static place(): Order { return new Order({ state: 'pending' }); }
  confirm(): void { if (this.props.state !== 'pending') return; this.props.state = 'confirmed'; }
  cancel(): void { if (this.props.state !== 'pending' && this.props.state !== 'confirmed') return; this.props.state = 'cancelled'; }
}
`,
};

const GATE_SOURCES = {
  'src/aggregate-root.ts': AGGREGATE_ROOT,
  'src/gate.ts': `
import { AggregateRoot } from './aggregate-root';
export class Gate extends AggregateRoot<{ state: 'open' | 'closed' }> {
  static open(): Gate { return new Gate({ state: 'open' }); }
  isClosed(): boolean { return this.props.state === 'closed'; }
  close(): void { if (this.isClosed()) return; this.props.state = 'closed'; }
}
`,
};

const ORDER_TRANSITIONS_QUESTION = 'state transitions [confirm from pending; cancel from pending, confirmed]. Keep? [Y/n/e] ';

const CONFIRM_ENTRY_QUESTION =
  'state: confirm() runs from [pending] (known: pending, confirmed, shipped, cancelled; comma-separated, - for none, Enter to keep): ';

const initAnswering = async (files: Readonly<Record<string, string>>, answers: readonly string[]) => {
  const dir = writeProject(files);
  const captured = captureIo(dir, answers);
  const exitCode = await run(['init'], captured.io);
  return { dir, exitCode, ...captured };
};

const configAfterAnswering = async (files: Readonly<Record<string, string>>, answers: readonly string[]): Promise<string> =>
  readConfig((await initAnswering(files, answers)).dir);

const initWithEndingInput = async (dir: string, typed: string): Promise<number> => {
  const input = new PassThrough();
  input.end(typed);
  const terminal = terminalPrompt(input, new PassThrough());
  const { io } = captureIo(dir, [], { interactive: true });
  const exitCode = await run(['init'], { ...io, prompt: terminal.prompt });
  terminal.close();
  return exitCode;
};

describe('init prompt', () => {
  it('asks whether to declare, skip or edit each suggestion', async () => {
    const { questions } = await initAnswering(TICKET_SOURCES, ['y']);

    expect(questions()).toEqual(['Ticket (src/ticket.ts): status [terminal: closed; transitions: close]. Declare? [Y/n/e] ']);
  });

  it('declares the suggestion when the answer is empty', async () => {
    const config = await configAfterAnswering(TICKET_SOURCES, ['']);

    expect(config).toContain('status: {\n          terminal: TicketStatus.closed,\n');
  });

  it('declares the suggestion when the answer is yes in any case', async () => {
    const config = await configAfterAnswering(TICKET_SOURCES, [' Yes ']);

    expect(config).toContain('status: {\n          terminal: TicketStatus.closed,\n');
  });

  it('skips the suggestion when the answer is no', async () => {
    const { stdout } = await initAnswering(TICKET_SOURCES, ['No']);

    expect(stdout()).toBe('Nothing declared.\n');
  });

  it('explains the expected answers when the answer is not recognised', async () => {
    const { stderr } = await initAnswering(TICKET_SOURCES, ['maybe', 'n']);

    expect(stderr()).toBe('Answer y, n or e.\n');
  });

  it('asks again when the answer is not recognised', async () => {
    const { questions } = await initAnswering(TICKET_SOURCES, ['maybe', 'n']);

    expect(questions()).toEqual([
      'Ticket (src/ticket.ts): status [terminal: closed; transitions: close]. Declare? [Y/n/e] ',
      'Ticket (src/ticket.ts): status [terminal: closed; transitions: close]. Declare? [Y/n/e] ',
    ]);
  });

  it('asks for the terminal values of each field when editing', async () => {
    const { questions } = await initAnswering(TICKET_SOURCES, ['e', '']);

    expect(questions()[1]).toBe('status terminal values [closed] (known: open, closed; comma-separated, - for none, Enter to keep): ');
  });

  it('writes the enum member typed by its label', async () => {
    const config = await configAfterAnswering(TICKET_SOURCES, ['edit', 'open']);

    expect(config).toContain('status: {\n          terminal: TicketStatus.open,\n');
  });

  it('writes several typed values as an array in the order of the field values', async () => {
    const config = await configAfterAnswering(INVITATION_SOURCES, ['e', 'rejected, pending']);

    expect(config).toContain("state: {\n          terminal: ['pending', 'rejected'],\n");
  });

  it('collapses a value typed twice', async () => {
    const config = await configAfterAnswering(INVITATION_SOURCES, ['e', 'rejected,rejected']);

    expect(config).toContain("state: {\n          terminal: 'rejected',\n");
  });

  it('shows a dash as the current value of a field without terminal values', async () => {
    const { questions } = await initAnswering({ 'src/aggregate-root.ts': AGGREGATE_ROOT, 'src/switch.ts': SWITCH }, ['e', '']);

    expect(questions()[1]).toBe('state terminal values [-] (known: on, off; comma-separated, - for none, Enter to keep): ');
  });

  it('writes a typed value that contains a comma', async () => {
    const config = await configAfterAnswering(SEPARATED_SOURCES, ['e', ' a,b ']);

    expect(config).toContain("state: {\n          terminal: 'a,b',\n");
  });

  it('imports only the aggregate when an edited enum field has no terminal values and no seeded transitions', async () => {
    const config = await configAfterAnswering(TICKET_CLOSED_BY_QUOTED_METHOD, ['e', '-']);

    expect(config).toContain("import { defineDomain, lifecycle } from 'domain-integrity';\nimport { Ticket } from './src/ticket';\n\n");
  });

  it('writes a config that check accepts with noUnusedLocals when an edited enum field has no terminal values', async () => {
    const dir = writeProject(TICKET_CLOSED_BY_QUOTED_METHOD, { noUnusedLocals: true });
    await run(['init'], captureIo(dir, ['e', '-']).io);

    expect(await run(['check'], captureIo(dir).io)).toBe(0);
  });

  it('writes no terminal values for a dash', async () => {
    const config = await configAfterAnswering(INVITATION_SOURCES, ['e', '-']);

    expect(config).toContain('state: {\n          terminal: [],\n');
  });

  it('keeps the suggested values when the edit is left empty', async () => {
    const config = await configAfterAnswering(INVITATION_SOURCES, ['e', '']);

    expect(config).toContain("state: {\n          terminal: ['accepted', 'rejected'],\n");
  });

  it('names an unknown typed value and the known values', async () => {
    const { stderr } = await initAnswering(TICKET_SOURCES, ['e', 'done', 'closed']);

    expect(stderr()).toBe('Unknown terminal value "done" for status; known values: open, closed.\n');
  });

  it('names every unknown typed value', async () => {
    const { stderr } = await initAnswering(INVITATION_SOURCES, ['e', 'expired, accepted, lost', '']);

    expect(stderr()).toBe('Unknown terminal values "expired", "lost" for state; known values: pending, accepted, rejected.\n');
  });

  it('explains how to answer when the edit holds no value', async () => {
    const { stderr } = await initAnswering(INVITATION_SOURCES, ['e', ' , ', '']);

    expect(stderr()).toBe('No terminal value given for state; type known values separated by commas, - for none, or press Enter to keep the suggestion.\n');
  });

  it('writes the value typed after an unknown one', async () => {
    const config = await configAfterAnswering(TICKET_SOURCES, ['e', 'open, done', 'open']);

    expect(config).toContain('status: {\n          terminal: TicketStatus.open,\n');
  });

  it('asks for the field again after an unknown value', async () => {
    const { questions } = await initAnswering(TICKET_SOURCES, ['e', 'done', 'closed']);

    expect(questions().slice(1, 3)).toEqual([
      'status terminal values [closed] (known: open, closed; comma-separated, - for none, Enter to keep): ',
      'status terminal values [closed] (known: open, closed; comma-separated, - for none, Enter to keep): ',
    ]);
  });

  it('asks for the terminal values of every field of the suggestion', async () => {
    const { questions } = await initAnswering(PARCEL_SOURCES, ['e', '', '', '', '']);

    expect([questions()[1], questions()[3]]).toEqual([
      'state terminal values [sent] (known: packed, sent; comma-separated, - for none, Enter to keep): ',
      'label terminal values [printed] (known: blank, printed; comma-separated, - for none, Enter to keep): ',
    ]);
  });

  it('writes the values typed for each field', async () => {
    const config = await configAfterAnswering(PARCEL_SOURCES, ['e', '', '', '-']);

    expect(config).toContain(
      "states: {\n        state: {\n          terminal: 'sent',\n          transitions: {\n            send: { from: ['packed'] },\n          },\n        },\n        label: {\n          terminal: [],\n          transitions: {\n            print: { from: ['blank'] },\n          },\n        },\n      },",
    );
  });

  it('never prompts with --yes', async () => {
    const dir = writeProject(TICKET_SOURCES);
    const { io, questions } = captureIo(dir, ['n']);
    await run(['init', '--yes'], io);

    expect(questions()).toEqual([]);
  });

  it('writes an edited enum declaration that check accepts', async () => {
    const { dir } = await initAnswering({ 'src/aggregate-root.ts': AGGREGATE_ROOT, 'src/orders/order.ts': orderWithEnumIn('paid') }, ['e', 'paid']);

    expect(await run(['check'], captureIo(dir).io)).toBe(0);
  });

  it('exits 2 when the input ends during the prompt', async () => {
    const dir = writeProject(TICKET_SOURCES);

    const exitCode = await initWithEndingInput(dir, 'e\n');

    expect(exitCode).toBe(2);
  });

  it('writes no config when the input ends during the prompt', async () => {
    const dir = writeProject(TICKET_SOURCES);

    await initWithEndingInput(dir, 'e\n');

    expect(existsSync(join(dir, 'domain.config.ts'))).toBe(false);
  });

  it('names the seeded transitions of a field when asking whether to declare', async () => {
    const { questions } = await initAnswering(ORDER_SOURCES, ['n']);

    expect(questions()).toEqual(['Order (src/order.ts): state [terminal: cancelled; transitions: confirm, cancel]. Declare? [Y/n/e] ']);
  });

  it('names the methods whose transitions were withheld when asking whether to declare', async () => {
    const { questions } = await initAnswering(GATE_SOURCES, ['n']);

    expect(questions()).toEqual(['Gate (src/gate.ts): state [terminal: none; transitions withheld: close]. Declare? [Y/n/e] ']);
  });

  it('asks whether to keep the seeded transitions after the terminal values when editing', async () => {
    const { questions } = await initAnswering(ORDER_SOURCES, ['e', '', '']);

    expect(questions()[2]).toBe(ORDER_TRANSITIONS_QUESTION);
  });

  it('asks nothing about transitions for a field whose transitions were withheld', async () => {
    const { questions } = await initAnswering(GATE_SOURCES, ['e', '']);

    expect(questions()).toHaveLength(2);
  });

  it('writes the seeded transitions when they are kept', async () => {
    const config = await configAfterAnswering(ORDER_SOURCES, ['e', '', 'y']);

    expect(config).toContain(
      "state: {\n          terminal: 'cancelled',\n          transitions: {\n            confirm: { from: ['pending'] },\n            cancel: { from: ['pending', 'confirmed'] },\n          },\n        },",
    );
  });

  it('writes the field without transitions when they are dropped', async () => {
    const config = await configAfterAnswering(ORDER_SOURCES, ['e', '', 'n']);

    expect(config).toContain("states: {\n        state: { terminal: 'cancelled' },\n      },");
  });

  it('prints no note about withheld transitions when the seeded ones are dropped', async () => {
    const { stdout } = await initAnswering(ORDER_SOURCES, ['e', '', 'no']);

    expect(stdout()).not.toContain('No transitions seeded');
  });

  it('explains the expected answers when the answer about transitions is not recognised', async () => {
    const { stderr } = await initAnswering(ORDER_SOURCES, ['e', '', 'maybe', '']);

    expect(stderr()).toBe('Answer y, n or e.\n');
  });

  it('asks where each seeded transition runs from when editing the transitions', async () => {
    const { questions } = await initAnswering(ORDER_SOURCES, ['e', '', 'e', '', '']);

    expect(questions()[3]).toBe(CONFIRM_ENTRY_QUESTION);
  });

  it('writes a transition that runs from no state for a dash', async () => {
    const config = await configAfterAnswering(ORDER_SOURCES, ['e', '', 'edit', '-', '']);

    expect(config).toContain("confirm: { from: [] },\n");
  });

  it('writes the typed source states of a transition in the order of the field values', async () => {
    const config = await configAfterAnswering(ORDER_SOURCES, ['e', '', 'e', 'shipped, pending', '']);

    expect(config).toContain("confirm: { from: ['pending', 'shipped'] },\n");
  });

  it('keeps the suggested source states of a transition when its edit is left empty', async () => {
    const config = await configAfterAnswering(ORDER_SOURCES, ['e', '', 'e', '', '-']);

    expect(config).toContain("confirm: { from: ['pending'] },\n            cancel: { from: [] },\n");
  });

  it('names an unknown source state and the known values', async () => {
    const { stderr } = await initAnswering(ORDER_SOURCES, ['e', '', 'e', 'done', '', '']);

    expect(stderr()).toBe('Unknown value "done" for state transitions.confirm; known values: pending, confirmed, shipped, cancelled.\n');
  });

  it('asks for the transition again after an unknown source state', async () => {
    const { questions } = await initAnswering(ORDER_SOURCES, ['e', '', 'e', 'done', '', '']);

    expect(questions().slice(3, 5)).toEqual([CONFIRM_ENTRY_QUESTION, CONFIRM_ENTRY_QUESTION]);
  });

  it('explains how to answer when the edit of a transition holds no value', async () => {
    const { stderr } = await initAnswering(ORDER_SOURCES, ['e', '', 'e', ' , ', '', '']);

    expect(stderr()).toBe(
      'No value given for state transitions.confirm; type known values separated by commas, - for none, or press Enter to keep the suggestion.\n',
    );
  });

  it('writes a typed source state that contains a comma', async () => {
    const config = await configAfterAnswering(SEPARATED_SOURCES, ['e', '', 'e', ' a,b ']);

    expect(config).toContain("finish: { from: ['a,b'] },\n");
  });

  it('exits 2 when the input ends during the transitions question', async () => {
    const dir = writeProject(TICKET_SOURCES);

    const exitCode = await initWithEndingInput(dir, 'e\n\n');

    expect(exitCode).toBe(2);
  });

  it('writes no config when the input ends during the transitions question', async () => {
    const dir = writeProject(TICKET_SOURCES);

    await initWithEndingInput(dir, 'e\n\n');

    expect(existsSync(join(dir, 'domain.config.ts'))).toBe(false);
  });
});
