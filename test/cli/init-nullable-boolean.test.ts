import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli/run';
import { captureIo, writeProject } from '../helpers/disk';
import { AGGREGATE_ROOT } from '../helpers/in-memory';
import { declarationIn } from '../helpers/init-project';

const shapes = [
  ['boolean | null', 'null', 'true', ['false', 'unset']],
  ['boolean | undefined', 'undefined', 'true', ['false', 'unset']],
  ['boolean | null | undefined', 'null', 'true', ['false', 'unset']],
  ['true | null', 'null', 'true', ['unset']],
  ['false | undefined', 'undefined', 'false', ['unset']],
] as const;

const sources = (type: string, initial: string, terminal: string) => ({
  'src/aggregate-root.ts': AGGREGATE_ROOT,
  'src/ticket.ts': `
import { AggregateRoot } from './aggregate-root';
export class Ticket extends AggregateRoot<{ state: ${type} }> {
  static create(): Ticket { return new Ticket({ state: ${initial} }); }
  close(): void { if (this.props.state === ${terminal}) return; this.props.state = ${terminal}; }
}
`,
});

for (const [type, initial, terminal, from] of shapes) {
  describe(`init ${type}`, () => {
    it('accepts the discovered field', async () => {
      const dir = writeProject(sources(type, initial, terminal));

      const code = await run(['init', '--yes'], captureIo(dir).io);

      expect(code).toBe(0);
    });

    it('writes the existing primitive boolean and unset config values', async () => {
      const dir = writeProject(sources(type, initial, terminal));
      await run(['init', '--yes'], captureIo(dir).io);

      const field = declarationIn(dir).lifecycles[0]?.fields[0];

      expect(field).toEqual({ name: 'state', terminal: [terminal], transitions: new Map([['close', [...from]]]), allowAfterTerminal: [] });
    });

    it('accepts the generated config when checking the project', async () => {
      const dir = writeProject(sources(type, initial, terminal));
      await run(['init', '--yes'], captureIo(dir).io);

      expect(await run(['check'], captureIo(dir).io)).toBe(0);
    });
  });
}
