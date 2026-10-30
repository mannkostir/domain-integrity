import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli/run';
import { TICKET_SOURCES, captureIo, writeProject } from '../helpers/disk';
import { AGGREGATE_ROOT } from '../helpers/in-memory';

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

const initOutput = async (files: Readonly<Record<string, string>>): Promise<string> => {
  const { io, stdout } = captureIo(writeProject(files));
  await run(['init', '--yes'], io);
  return stdout();
};

describe('init output about transitions', () => {
  it('explains that no transitions were seeded for a field whose guard it cannot follow', async () => {
    const output = await initOutput(GATE_SOURCES);

    expect(output).toContain('No transitions seeded for Gate.state: init cannot tell which states close() runs from.\n');
  });

  it('asks for a review of the terminal states and transitions', async () => {
    const output = await initOutput(TICKET_SOURCES);

    expect(output).toBe('Declared 1 aggregate in domain.config.ts. Review the terminal states and transitions, then run "domain-integrity check".\n');
  });
});
