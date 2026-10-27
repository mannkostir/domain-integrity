import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli/run';
import { captureIo, writeProject } from '../helpers/disk';
import { AGGREGATE_ROOT } from '../helpers/in-memory';

const PROJECT = {
  'src/aggregate-root.ts': AGGREGATE_ROOT,
  'src/shipment.ts': `
import { AggregateRoot } from './aggregate-root';
export enum Stage { packed = 'PACKED', sent = 'SENT', lost = 'LOST' }
export class Shipment extends AggregateRoot<{ stage: Stage | null; note: string }> {
  static pack(): Shipment { return new Shipment({ stage: Stage.packed, note: '' }); }
  send(): void { if (this.props.stage !== Stage.packed) return; this.props.stage = Stage.sent; }
  label(): void { if (this.props.stage === null || this.props.stage === Stage.lost) return; this.props.note = 'x'; }
  lose(): void { this.props.stage = Stage.lost; }
}
`,
  'domain.config.ts': `
import { defineDomain, lifecycle } from 'domain-integrity';
import { Shipment, Stage } from './src/shipment';
export default defineDomain({ lifecycles: [lifecycle(Shipment, { states: { stage: { terminal: [Stage.lost] } } })] });
`,
};

type WireFinding = { readonly ruleId: string; readonly details: Readonly<Record<string, unknown>> };

describe('check over an enum state field that may be null', () => {
  it('reports only the method that can run after the terminal state', async () => {
    const { io, stdout } = captureIo(writeProject(PROJECT));
    await run(['check', '--format', 'json'], io);
    const { findings } = JSON.parse(stdout()) as { findings: readonly WireFinding[] };

    expect(findings.map((finding) => [finding.ruleId, finding.details.method])).toEqual([['terminal-state-leak', 'lose']]);
  });
});
