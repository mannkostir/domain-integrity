import { describe, expect, it } from 'vitest';
import { discoverAggregates } from '../../../src/analyzers/lifecycle/discover';
import { AGGREGATE_ROOT, inMemoryProject } from '../../helpers/in-memory';

const project = inMemoryProject({
  '/src/base.ts': `${AGGREGATE_ROOT}\nexport abstract class Versioned<P extends object> extends AggregateRoot<P> {}\n`,
  '/src/aggregates.ts': `
import { AggregateRoot, Versioned } from './base';
export class Direct extends AggregateRoot {}
export class Indirect extends Versioned<{ a: number }> {}
export class Plain {}
`,
  '/src/external.ts': `
import { AggregateRoot } from '@unresolved/ddd';
export class External extends AggregateRoot {}
`,
});

const files = project.getSourceFiles();
const names = (classes: { getName(): string | undefined }[]) => classes.map((cls) => cls.getName()).sort();

describe('discoverAggregates', () => {
  it('finds direct, transitive and unresolved-base subclasses but not abstract or plain classes', () => {
    expect(names(discoverAggregates(files, ['AggregateRoot'], []))).toEqual(['Direct', 'External', 'Indirect']);
  });

  it('includes declared classes that extend no known base', () => {
    const plain = project.getSourceFileOrThrow('/src/aggregates.ts').getClassOrThrow('Plain');

    expect(names(discoverAggregates(files, ['AggregateRoot'], [plain]))).toEqual(['Direct', 'External', 'Indirect', 'Plain']);
  });
});
