import { describe, expect, it } from 'vitest';
import { mentionedTokens } from '../../../src/analyzers/lifecycle/mentions';
import { resolvedField } from '../../helpers/describe';
import { AGGREGATE_ROOT, inMemoryProject } from '../../helpers/in-memory';

const ENUM_SOURCE = `
export enum Status { open = 'OPEN', closed = 'CLOSED' }
`;

const mentionsFor = (fieldName: string, aggregateType: string, extra: string, aggregateImports = '') => {
  const project = inMemoryProject({
    '/src/aggregate-root.ts': AGGREGATE_ROOT,
    '/src/status.ts': ENUM_SOURCE,
    '/src/thing.ts': `
import { AggregateRoot } from './aggregate-root';
import { Status } from './status';
${aggregateImports}
export class Thing extends AggregateRoot<{ ${fieldName}: ${aggregateType} }> {}
`,
    '/src/usage.ts': `import { Status } from './status';\n${extra}`,
  });
  const thing = project.getSourceFileOrThrow('/src/thing.ts').getClassOrThrow('Thing');
  return [...mentionedTokens(project.getSourceFiles(), resolvedField(thing, fieldName))].sort();
};

const enumMentions = (usage: string) => mentionsFor('status', 'Status', usage);
const unionMentions = (usage: string) => mentionsFor('state', "'accepted' | 'rejected'", usage);

describe('mentionedTokens', () => {
  it('counts an enum member used in an object literal in another file', () => {
    expect(enumMentions('export const value = { status: Status.closed };')).toEqual(['CLOSED']);
  });

  it('does not count an enum member used only in a comparison', () => {
    expect(enumMentions('export const check = (x: { status: Status }) => x.status === Status.closed;')).toEqual([]);
  });

  it('does not count an enum member used only as a case label', () => {
    expect(
      enumMentions('export const check = (x: Status) => { switch (x) { case Status.closed: return 1; default: return 0; } };'),
    ).toEqual([]);
  });

  it('does not count the enum declaration own initializer', () => {
    expect(enumMentions('export const nothing = 1;')).toEqual([]);
  });

  it('counts a union literal assigned in a plain object', () => {
    expect(unionMentions("export const value = { state: 'accepted' };")).toEqual(['accepted']);
  });

  it('does not count a union literal used only in a type annotation', () => {
    expect(unionMentions("export let s: 'accepted' | 'rejected';")).toEqual([]);
  });

  it('does not count a union literal used only in a comparison', () => {
    expect(unionMentions("export const check = (x: string) => x === 'accepted';")).toEqual([]);
  });

  it('counts an enum member read through an element access', () => {
    expect(enumMentions("export const value = { status: Status['closed'] };")).toEqual(['CLOSED']);
  });

  it('counts every member when the enum is enumerated with Object.values', () => {
    expect(enumMentions('export const all = Object.values(Status);')).toEqual(['CLOSED', 'OPEN']);
  });

  it('counts every member when the enum is destructured', () => {
    expect(enumMentions('export const { closed } = Status;')).toEqual(['CLOSED', 'OPEN']);
  });

  it('counts a member used in the initializer of another enum', () => {
    expect(enumMentions('export enum Other { a = Status.closed }')).toEqual(['CLOSED']);
  });

  it('counts a member used inside a class heritage call', () => {
    expect(
      enumMentions('const mix = (value: unknown) => class {};\nexport class K extends mix(Status.closed) {}'),
    ).toEqual(['CLOSED']);
  });

  it('counts an enum value cast from a string literal', () => {
    expect(enumMentions("export const value = 'CLOSED' as Status;")).toEqual(['CLOSED']);
  });

  it('counts an enum member used through an alias import', () => {
    expect(
      enumMentions("import { Status as S } from './status';\nexport const x = { status: S.closed };"),
    ).toEqual(['CLOSED']);
  });

  it('counts a union literal written as a template literal', () => {
    expect(unionMentions('export const value = { state: `accepted` };')).toEqual(['accepted']);
  });

  it('gives an empty set for a boolean field', () => {
    expect(mentionsFor('flag', 'boolean', 'export const value = { flag: true };')).toEqual([]);
  });

  it('gives an empty set for a nullable field', () => {
    expect(mentionsFor('at', 'Date | null', 'export const value = { at: null };')).toEqual([]);
  });
});
