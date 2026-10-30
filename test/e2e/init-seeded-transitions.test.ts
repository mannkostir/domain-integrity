import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli/run';
import { captureIo, writeProject } from '../helpers/disk';
import { AGGREGATE_ROOT } from '../helpers/in-memory';
import { declarationIn } from '../helpers/init-project';

const CONFIRM_GUARD = "    if (this.props.status !== OrderStatus.pending) throw new Error('Only a pending order can be confirmed');\n";

const CANCEL_GUARD =
  "    if (this.props.status !== OrderStatus.pending && this.props.status !== OrderStatus.confirmed) throw new Error('Too late to cancel');\n";

const ORDER = `import { AggregateRoot } from './aggregate-root';

export enum OrderStatus { pending = 'PENDING', confirmed = 'CONFIRMED', shipped = 'SHIPPED', cancelled = 'CANCELLED' }

export class Order extends AggregateRoot<{ status: OrderStatus; shippedAt: Date | null; flagged: boolean }> {
  static place(): Order { return new Order({ status: OrderStatus.pending, shippedAt: null, flagged: false }); }

  confirm(): void {
${CONFIRM_GUARD}    this.props.status = OrderStatus.confirmed;
  }

  ship(): void {
    if (this.props.status !== OrderStatus.confirmed) return;
    this.props.status = OrderStatus.shipped;
    this.props.shippedAt = new Date();
  }

  cancel(): void {
${CANCEL_GUARD}    this.props.status = OrderStatus.cancelled;
  }

  reopen(): void {
    this.props.status = OrderStatus.pending;
  }

  flag(): void {
    if (this.props.flagged) return;
    this.props.flagged = true;
  }
}
`;

type WireFinding = { readonly ruleId: string; readonly details: { readonly method?: string; readonly kind?: string } };

type WireReport = { readonly findings: readonly WireFinding[]; readonly problems: readonly object[] };

const TRANSITION_RULES: readonly string[] = ['transition-drift', 'transition-missing'];

const seededProject = async (): Promise<string> => {
  const dir = writeProject({ 'src/aggregate-root.ts': AGGREGATE_ROOT, 'src/order.ts': ORDER });
  await run(['init', '--yes'], captureIo(dir).io);
  return dir;
};

const checkReportOf = async (dir: string): Promise<WireReport> => {
  const { io, stdout } = captureIo(dir);
  await run(['check', '--format', 'json'], io);
  return JSON.parse(stdout()) as WireReport;
};

const reportAfterEditing = async (edit: (source: string) => string): Promise<WireReport> => {
  const dir = await seededProject();
  writeFileSync(join(dir, 'src/order.ts'), edit(ORDER));
  return checkReportOf(dir);
};

const transitionFindings = (report: WireReport) =>
  report.findings
    .filter((finding) => TRANSITION_RULES.includes(finding.ruleId))
    .map(({ ruleId, details }) => ({ ruleId, method: details.method, kind: details.kind }));

describe('init seeding transitions for the code it reads', () => {
  it('declares the sources each status writer runs from', async () => {
    const dir = await seededProject();

    expect(declarationIn(dir).lifecycles[0]?.fields[0]?.transitions).toEqual(
      new Map([
        ['confirm', ['PENDING']],
        ['ship', ['CONFIRMED']],
        ['cancel', ['PENDING', 'CONFIRMED']],
        ['reopen', ['PENDING', 'CONFIRMED', 'SHIPPED', 'CANCELLED']],
      ]),
    );
  });

  it('writes a config whose check reports no transition findings', async () => {
    const report = await checkReportOf(await seededProject());

    expect(transitionFindings(report)).toEqual([]);
  });

  it('writes a config whose check reports no problems', async () => {
    const report = await checkReportOf(await seededProject());

    expect(report.problems).toEqual([]);
  });

  it('reports extra sources once a seeded guard is removed', async () => {
    const report = await reportAfterEditing((source) => source.replace(CONFIRM_GUARD, ''));

    expect(transitionFindings(report)).toEqual([{ ruleId: 'transition-drift', method: 'confirm', kind: 'extra' }]);
  });

  it('reports missing sources once a seeded guard is tightened', async () => {
    const report = await reportAfterEditing((source) =>
      source.replace(CANCEL_GUARD, "    if (this.props.status !== OrderStatus.pending) throw new Error('Too late to cancel');\n"),
    );

    expect(transitionFindings(report)).toEqual([{ ruleId: 'transition-missing', method: 'cancel', kind: undefined }]);
  });
});
