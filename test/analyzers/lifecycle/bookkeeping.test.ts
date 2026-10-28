import { describe, expect, it } from 'vitest';
import { NO_BOOKKEEPING } from '../../../src/analyzers/lifecycle/bookkeeping';
import { eventBuffers } from '../../../src/analyzers/lifecycle/event-buffer';
import { declaredMethod } from '../../../src/analyzers/lifecycle/instance-method';
import { mutatingMethods } from '../../../src/analyzers/lifecycle/mutation';
import { projectIndex } from '../../../src/analyzers/lifecycle/project-index';
import { inMemoryProject } from '../../helpers/in-memory';

const project = inMemoryProject({
  '/src/ledger.ts': `
class Opened {}
export class Ledger {
  private status: 'open' | 'closed' = 'open';
  private updatedAt = new Date();
  private version = 0;
  private props: { updatedAt: Date } = { updatedAt: new Date() };
  private audit: { updatedAt: Date } = { updatedAt: new Date() };
  private note = '';
  private events: object[] = [];
  private items: object[] = [];
  touch(): void { this.updatedAt = new Date(); }
  touchProps(): void { this.props.updatedAt = new Date(); }
  bump(): void { this.version++; }
  clearByLength(): void { this.events.length = 0; }
  clearByReset(): void { this.events = []; }
  clearBySplice(): void { this.events.splice(0); }
  pull(): object[] { const taken = this.events; this.events = []; return taken; }
  afterSave(): void { this.clearByLength(); this.touch(); }
  open(): void { this.events.push(new Opened()); }
  replay(): void { this.events = []; this.events.push(new Opened()); }
  rename(n: string): void { this.note = n; }
  touchAndRename(n: string): void { this.updatedAt = new Date(); this.note = n; }
  touchNested(): void { this.audit.updatedAt = new Date(); }
  clearItems(): void { this.items = []; }
  total(): number { return this.items.length; }
  close(): void { this.status = 'closed'; }
}
`,
});

const ledger = project.getSourceFileOrThrow('/src/ledger.ts').getClassOrThrow('Ledger');

const bookkeeping = {
  auditFields: new Set(['updatedAt', 'version']),
  eventBuffers: eventBuffers([ledger], projectIndex(project.getSourceFiles()).bracketWrites, [], new Set()),
};

const mutating = (): readonly string[] => [...mutatingMethods(ledger.getInstanceMethods().map(declaredMethod), [], bookkeeping)].sort();

describe('mutatingMethods with bookkeeping', () => {
  it('does not count methods that only write audit fields, reset event buffers or call such methods', () => {
    expect(mutating().filter((name) => ['touch', 'touchProps', 'bump', 'clearByLength', 'clearByReset', 'clearBySplice', 'pull', 'afterSave'].includes(name))).toEqual([]);
  });

  it('still counts event pushes, other fields, nested audit names, unproven arrays and state fields', () => {
    expect(mutating()).toEqual(['clearItems', 'close', 'open', 'rename', 'replay', 'touchAndRename', 'touchNested']);
  });

  it('counts every write without bookkeeping', () => {
    expect([...mutatingMethods(ledger.getInstanceMethods().map(declaredMethod), [], NO_BOOKKEEPING)]).toContain('touch');
  });
});
