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

const SEPARATED = `
import { AggregateRoot } from './aggregate-root';
export class Separated extends AggregateRoot<{ state: 'open' | 'a,b' | 'c' }> {
  static open(): Separated { return new Separated({ state: 'open' }); }
  finish(): void { if (this.props.state === 'c') return; this.props.state = 'c'; }
}
`;

const SEPARATED_SOURCES = { 'src/aggregate-root.ts': AGGREGATE_ROOT, 'src/separated.ts': SEPARATED };

const initAnswering = async (files: Readonly<Record<string, string>>, answers: readonly string[]) => {
  const dir = writeProject(files);
  const captured = captureIo(dir, answers);
  const exitCode = await run(['init'], captured.io);
  return { dir, exitCode, ...captured };
};

const configAfterAnswering = async (files: Readonly<Record<string, string>>, answers: readonly string[]): Promise<string> =>
  readConfig((await initAnswering(files, answers)).dir);

const initWithEndingInput = async (dir: string): Promise<number> => {
  const input = new PassThrough();
  input.end('e\n');
  const terminal = terminalPrompt(input, new PassThrough());
  const { io } = captureIo(dir, [], { interactive: true });
  const exitCode = await run(['init'], { ...io, prompt: terminal.prompt });
  terminal.close();
  return exitCode;
};

describe('init prompt', () => {
  it('asks whether to declare, skip or edit each suggestion', async () => {
    const { questions } = await initAnswering(TICKET_SOURCES, ['y']);

    expect(questions()).toEqual(['Ticket (src/ticket.ts): status [terminal: closed]. Declare? [Y/n/e] ']);
  });

  it('declares the suggestion when the answer is empty', async () => {
    const config = await configAfterAnswering(TICKET_SOURCES, ['']);

    expect(config).toContain('status: { terminal: TicketStatus.closed },');
  });

  it('declares the suggestion when the answer is yes in any case', async () => {
    const config = await configAfterAnswering(TICKET_SOURCES, [' Yes ']);

    expect(config).toContain('status: { terminal: TicketStatus.closed },');
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
      'Ticket (src/ticket.ts): status [terminal: closed]. Declare? [Y/n/e] ',
      'Ticket (src/ticket.ts): status [terminal: closed]. Declare? [Y/n/e] ',
    ]);
  });

  it('asks for the terminal values of each field when editing', async () => {
    const { questions } = await initAnswering(TICKET_SOURCES, ['e', '']);

    expect(questions()[1]).toBe('status terminal values [closed] (known: open, closed; comma-separated, - for none, Enter to keep): ');
  });

  it('writes the enum member typed by its label', async () => {
    const config = await configAfterAnswering(TICKET_SOURCES, ['edit', 'open']);

    expect(config).toContain('status: { terminal: TicketStatus.open },');
  });

  it('writes several typed values as an array in the order of the field values', async () => {
    const config = await configAfterAnswering(INVITATION_SOURCES, ['e', 'rejected, pending']);

    expect(config).toContain("state: { terminal: ['pending', 'rejected'] },");
  });

  it('collapses a value typed twice', async () => {
    const config = await configAfterAnswering(INVITATION_SOURCES, ['e', 'rejected,rejected']);

    expect(config).toContain("state: { terminal: 'rejected' },");
  });

  it('shows a dash as the current value of a field without terminal values', async () => {
    const { questions } = await initAnswering({ 'src/aggregate-root.ts': AGGREGATE_ROOT, 'src/switch.ts': SWITCH }, ['e', '']);

    expect(questions()[1]).toBe('state terminal values [-] (known: on, off; comma-separated, - for none, Enter to keep): ');
  });

  it('writes a typed value that contains a comma', async () => {
    const config = await configAfterAnswering(SEPARATED_SOURCES, ['e', ' a,b ']);

    expect(config).toContain("state: { terminal: 'a,b' },");
  });

  it('imports only the aggregate when an edited enum field has no terminal values', async () => {
    const config = await configAfterAnswering(TICKET_SOURCES, ['e', '-']);

    expect(config).toContain("import { defineDomain, lifecycle } from 'domain-integrity';\nimport { Ticket } from './src/ticket';\n\n");
  });

  it('writes a config that check accepts with noUnusedLocals when an edited enum field has no terminal values', async () => {
    const dir = writeProject(TICKET_SOURCES, { noUnusedLocals: true });
    await run(['init'], captureIo(dir, ['e', '-']).io);

    expect(await run(['check'], captureIo(dir).io)).toBe(0);
  });

  it('writes no terminal values for a dash', async () => {
    const config = await configAfterAnswering(INVITATION_SOURCES, ['e', '-']);

    expect(config).toContain('state: { terminal: [] },');
  });

  it('keeps the suggested values when the edit is left empty', async () => {
    const config = await configAfterAnswering(INVITATION_SOURCES, ['e', '']);

    expect(config).toContain("state: { terminal: ['accepted', 'rejected'] },");
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

    expect(config).toContain('status: { terminal: TicketStatus.open },');
  });

  it('asks for the field again after an unknown value', async () => {
    const { questions } = await initAnswering(TICKET_SOURCES, ['e', 'done', 'closed']);

    expect(questions().slice(1)).toEqual([
      'status terminal values [closed] (known: open, closed; comma-separated, - for none, Enter to keep): ',
      'status terminal values [closed] (known: open, closed; comma-separated, - for none, Enter to keep): ',
    ]);
  });

  it('asks for the terminal values of every field of the suggestion', async () => {
    const { questions } = await initAnswering(PARCEL_SOURCES, ['e', '', '']);

    expect(questions().slice(1)).toEqual([
      'state terminal values [sent] (known: packed, sent; comma-separated, - for none, Enter to keep): ',
      'label terminal values [printed] (known: blank, printed; comma-separated, - for none, Enter to keep): ',
    ]);
  });

  it('writes the values typed for each field', async () => {
    const config = await configAfterAnswering(PARCEL_SOURCES, ['e', '', '-']);

    expect(config).toContain("states: {\n        state: { terminal: 'sent' },\n        label: { terminal: [] },\n      },");
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

    const exitCode = await initWithEndingInput(dir);

    expect(exitCode).toBe(2);
  });

  it('writes no config when the input ends during the prompt', async () => {
    const dir = writeProject(TICKET_SOURCES);

    await initWithEndingInput(dir);

    expect(existsSync(join(dir, 'domain.config.ts'))).toBe(false);
  });
});
