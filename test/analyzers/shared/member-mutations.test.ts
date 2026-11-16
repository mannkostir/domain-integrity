import { describe, expect, it } from 'vitest';
import { SyntaxKind } from 'ts-morph';
import { MemberMutations } from '../../../src/analyzers/shared/member-mutations';
import { SourceIndex } from '../../../src/analyzers/shared/source-index';
import { inMemoryProject } from '../../helpers/in-memory';

const owner = 'class Owner { readonly identity = "owner"; method() {} }';
const fixture = (extra: string, declaration = owner) => {
  const project = inMemoryProject({ '/src/input.ts': declaration + extra });
  const source = project.getSourceFileOrThrow('/src/input.ts');
  const member = source.getClassOrThrow('Owner').getMethodOrThrow('method');
  return { project, member, mutations: new MemberMutations(new SourceIndex([source])) };
};

describe('member mutation authority', () => {
  it.each([
    ['union containing the owner', 'Owner | { method(): void; unrelated: string }', 'other'],
    ['union excluding the owner', '{ method(): void; first: string } | { method(): void; second: number }', 'none'],
    ['intersection containing the owner', 'Owner & { label: string }', 'other'],
    ['intersection excluding the owner', '{ method(): void; first: string } & { method(): void; second: number }', 'none'],
    ['generic union constraint', 'T', 'other', '<T extends Owner | { method(): void; unrelated: string }>'],
  ])('correlates a %s with the protocol member', (_, type, expected, generic = '') => {
    const { project, member, mutations } = fixture(`function replace${generic}(target: ${type}) { target.method = () => {}; }`);
    expect(project.getPreEmitDiagnostics()).toEqual([]);

    const result = mutations.evidenceOf(member);

    expect(result).toBe(expected);
  });

  it.each([
    ['quoted method name', '{ "method": () => {} }', 'other'],
    ['quoted unrelated name', '{ "label": "label" }', 'none'],
    ['literal method name', '{ ["method"]: () => {} }', 'other'],
    ['template method name', '{ [`method`]: () => {} }', 'other'],
    ['template unrelated name', '{ [`label`]: "label" }', 'none'],
    ['unknown computed name', '{ [key]: () => {} }', 'other'],
    ['unrelated computed union', '{ [key]: () => {} }', 'none', 'declare const key: "first" | "second";'],
    ['opaque source', 'source', 'other', 'declare const source: object;'],
  ])('correlates an assignment from a %s', (_, values, expected, declarations = 'declare const key: string;') => {
    const { project, member, mutations } = fixture(`${declarations} const target = new Owner(); Object.assign(target, ${values});`);
    expect(project.getPreEmitDiagnostics()).toEqual([]);

    const result = mutations.evidenceOf(member);

    expect(result).toBe(expected);
  });

  it.each([
    ['object literal', '{}'],
    ['array literal', '[]'],
    ['unrelated instance', 'new Other()'],
  ])('keeps a fresh %s separate from the protocol owner', (_, target) => {
    const { project, member, mutations } = fixture(`class Other { method() {} } Object.assign(${target}, { method: () => {} });`);
    expect(project.getPreEmitDiagnostics()).toEqual([]);

    const result = mutations.evidenceOf(member);

    expect(result).toBe('none');
  });

  it('retains uncertainty after a receiver is destructured from an opaque iterable', () => {
    const { project, member, mutations } = fixture('let target: Owner = new Owner(); declare const values: Owner[]; [target] = values; target.method = () => {};');
    expect(project.getPreEmitDiagnostics()).toEqual([]);

    const result = mutations.evidenceOf(member);

    expect(result).toBe('other');
  });

  it('retains uncertainty for cyclic receiver aliases', () => {
    const { project, member, mutations } = fixture('let first: Owner; let second: Owner; first = second!; second = first; first.method = () => {};');
    expect(project.getPreEmitDiagnostics()).toEqual([]);

    const result = mutations.evidenceOf(member);

    expect(result).toBe('other');
  });

  it('correlates this in a class field initializer with its owner', () => {
    const { project, member, mutations } = fixture('', 'class Owner { method() {} replace = (this.method = () => {}); }');
    expect(project.getPreEmitDiagnostics()).toEqual([]);

    const result = mutations.evidenceOf(member);

    expect(result).toBe('other');
  });

  it('keeps a nested ordinary function this conservative', () => {
    const { project, member, mutations } = fixture('function replace(this: Owner) { this.method = () => {}; }');
    expect(project.getPreEmitDiagnostics()).toEqual([]);

    const result = mutations.evidenceOf(member);

    expect(result).toBe('other');
  });

  it('keeps an unresolved base conservative for a written subclass instance', () => {
    const { member, mutations } = fixture('class Child extends Missing {} const target = new Child(); target.method = () => {};');

    const result = mutations.evidenceOf(member);

    expect(result).toBe('other');
  });

  it('does not grant class protocol facts to an object literal method', () => {
    const project = inMemoryProject({ '/src/input.ts': 'const value = { method() {} };' });
    const source = project.getSourceFileOrThrow('/src/input.ts');
    const method = source.getDescendantsOfKind(SyntaxKind.MethodDeclaration)[0]!;
    const mutations = new MemberMutations(new SourceIndex([source]));
    expect(project.getPreEmitDiagnostics()).toEqual([]);

    const result = [mutations.mayWrite(method), mutations.evidenceOf(method)];

    expect(result).toEqual([true, 'other']);
  });

  it('keeps top-level this conservative', () => {
    const { project, member, mutations } = fixture('Object.assign(this, { method: () => {} });');
    expect(project.getPreEmitDiagnostics()).toEqual([]);

    const result = mutations.evidenceOf(member);

    expect(result).toBe('other');
  });

  it('does not confuse a user-defined reflection receiver with the global operation', () => {
    const { project, member, mutations } = fixture('const custom = { reflect: { defineProperty(target: Owner, name: string, value: object) {} } }; custom.reflect.defineProperty(new Owner(), "method", { value: () => {} });');
    expect(project.getPreEmitDiagnostics()).toEqual([]);

    const result = mutations.evidenceOf(member);

    expect(result).toBe('none');
  });

  it('keeps an opaque descriptor property conservative', () => {
    const { project, member, mutations } = fixture('const descriptors = { attributes: { enumerable: true } }; Object.defineProperty(new Owner(), "method", descriptors.attributes);');
    expect(project.getPreEmitDiagnostics()).toEqual([]);

    const result = mutations.evidenceOf(member);

    expect(result).toBe('other');
  });

  it('keeps unknown sources in nested bulk-assignment spreads conservative', () => {
    const { project, member, mutations } = fixture('declare const sources: object[]; Object.assign(new Owner(), ...[...sources]);');
    expect(project.getPreEmitDiagnostics()).toEqual([]);

    const result = mutations.evidenceOf(member);

    expect(result).toBe('other');
  });

});
