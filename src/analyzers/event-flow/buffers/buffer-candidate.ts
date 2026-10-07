import { ClassDeclaration, MethodDeclaration, Node, PropertyDeclaration } from 'ts-morph';

export type BufferCandidate = {
  readonly buffer: PropertyDeclaration;
  readonly pushers: readonly MethodDeclaration[];
  readonly family: readonly ClassDeclaration[];
  readonly arrays: ReadonlySet<Node>;
};
