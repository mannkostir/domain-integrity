import { describe, expect, it } from 'vitest';
import { lifecycleAnalyzer } from '../../../src/analyzers/lifecycle/analyzer';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { inMemoryProject } from '../../helpers/in-memory';

const findings = (condition: string, listed: readonly string[], member = '') => {
  const project = inMemoryProject({
    '/library.d.ts': 'export declare class Base { get active(): boolean; allowed(): boolean; readonly flag: boolean; }',
    '/order.ts': `import { Base as Parent } from './library'; export class Order extends Parent {
      status: 'open' | 'closed' = 'open'; label = ''; ${member}
      rename() { if (${condition}) return; this.label = 'x'; }
      unguarded() { this.label = 'x'; }
    }`,
  });
  const target = project.getSourceFileOrThrow('/order.ts').getClassOrThrow('Order');
  const model = lifecycleAnalyzer.extract({
    declaration: { ...DEFAULT_DECLARATION, inertMembers: listed, lifecycles: [{ target, fields: [{ name: 'status', terminal: ['closed'], transitions: undefined, allowAfterTerminal: [] }], allowAfterTerminal: [] }] },
    files: project.getSourceFiles(), projectRoot: '/', repositoryRoot: '/',
  });
  return lifecycleAnalyzer.check(model).filter(finding => finding.ruleId === 'terminal-state-leak').map(finding => finding.details.method);
};

describe('asserted inert library guard conditions', () => {
  it.each([['this.active', 'active'], ['!this.active', 'active'], ['this.allowed()', 'allowed'], ['this.flag', 'flag'], ["this['active']", 'active'], ['super.active', 'active'], ['this.active === true', 'active'], ['false !== this.allowed()', 'allowed'], ['this.flag === false', 'flag']])('keeps the independent condition %s', (condition, name) => {
    expect(findings(condition, [name])).toContain('rename');
  });
  it.each(['this.active', 'this.allowed()', 'this.flag'])('keeps unlisted %s unknown', condition => {
    expect(findings(condition, [])).not.toContain('rename');
  });
  it('preserves a project override', () => {
    expect(findings('this.active', ['active'], "override get active() { return this.status === 'closed'; }")).not.toContain('rename');
  });
  it('preserves a shadowing project property', () => {
    expect(findings('this.flag', ['flag'], "override flag = this.status === 'closed';")).not.toContain('rename');
  });
  it('preserves an actual tracked field', () => {
    expect(findings("this.status === 'closed'", ['status'])).not.toContain('rename');
  });
});
