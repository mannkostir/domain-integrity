import { ClassDeclaration, Node, ParameterDeclaration, SyntaxKind, VariableDeclarationKind } from 'ts-morph';
import { sourceDeclaration } from '../../engine/source-declaration';
import { MemberMutations, MutationEvidence, mergedMutationEvidence } from '../shared/member-mutations';
import { NameUses } from '../shared/name-uses';
import { SourceIndex } from '../shared/source-index';
import { isWritten } from '../shared/writes';
import { outermostWrapper, unwrap } from '../shared/wrappers';
import { InstanceMethod, resolveInstanceMethod } from './instance-method';
import { AggregateScope } from './field-ref';
import { EntryPoint } from './model';

type Dispatch = {
  readonly method: InstanceMethod;
  readonly parameter: ParameterDeclaration;
  readonly prefix: string;
  readonly suffix: string;
  readonly discriminator: string;
};

const sourceChain = (cls: ClassDeclaration, sources: SourceIndex, seen = new Set<ClassDeclaration>()): readonly ClassDeclaration[] => {
  const source = sourceDeclaration(cls, sources.files);
  if (source === undefined || seen.has(source)) return [];
  const base = source.getBaseClass();
  return [source, ...(base === undefined ? [] : sourceChain(base, sources, new Set([...seen, source])))];
};

const bindingSymbol = (node: Node) => {
  const parent = node.getParent();
  return Node.isShorthandPropertyAssignment(parent) && parent.getNameNode() === node
    ? node.getProject().getTypeChecker().getShorthandAssignmentValueSymbol(parent)
    : node.getSymbol();
};

const sameBinding = (left: Node, right: Node): boolean =>
  Node.isIdentifier(left) && bindingSymbol(left) !== undefined && bindingSymbol(left) === bindingSymbol(right);

const unmodifiedBinding = (binding: Node, within: Node): boolean =>
  !within.getDescendantsOfKind(SyntaxKind.Identifier).some((reference) =>
    sameBinding(reference, binding) && isWritten(outermostWrapper(reference)),
  );

const unaliasedCollection = (collection: Node, within: Node): boolean =>
  within.getDescendantsOfKind(SyntaxKind.Identifier).filter((reference) => sameBinding(reference, collection)).every((reference) => {
    const parent = reference.getParent();
    return reference === collection ||
      (Node.isParameterDeclaration(parent) && parent.getNameNode() === reference) ||
      (Node.isPropertyAccessExpression(parent) && parent.getExpression() === reference && parent.getName() === 'length' &&
        !isWritten(outermostWrapper(parent)));
  });

const keyExpression = (node: Node): Node => {
  const expression = unwrap(node);
  if (!Node.isIdentifier(expression)) return expression;
  const declarations = expression.getSymbol()?.getDeclarations() ?? [];
  const only = declarations.length === 1 ? declarations[0] : undefined;
  if (!Node.isVariableDeclaration(only) || only.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const) return expression;
  return only.getInitializer() ?? expression;
};

const belongsTo = (node: Node, method: InstanceMethod): boolean =>
  node.getFirstAncestor((ancestor) => Node.isMethodDeclaration(ancestor) || Node.isArrowFunction(ancestor) ||
    Node.isFunctionDeclaration(ancestor) || Node.isFunctionExpression(ancestor) ||
    Node.isClassDeclaration(ancestor) || Node.isClassExpression(ancestor) || Node.isConstructorDeclaration(ancestor) ||
    Node.isGetAccessorDeclaration(ancestor) || Node.isSetAccessorDeclaration(ancestor)) === method.implementation;

const dispatches = (method: InstanceMethod): readonly Dispatch[] =>
  method.implementation.getDescendantsOfKind(SyntaxKind.CallExpression).flatMap((call): Dispatch[] => {
    if (!belongsTo(call, method)) return [];
    const access = unwrap(call.getExpression());
    if (!Node.isElementAccessExpression(access) || !Node.isThisExpression(unwrap(access.getExpression()))) return [];
    const argument = access.getArgumentExpression();
    if (argument === undefined) return [];
    const key = keyExpression(argument);
    if (!Node.isTemplateExpression(key)) return [];
    const spans = key.getTemplateSpans();
    if (spans.length !== 1) return [];
    const span = spans[0]!;
    const discriminator = span.getExpression();
    if (!Node.isPropertyAccessExpression(discriminator)) return [];
    const parameter = method.implementation.getParameters().find((candidate) => sameBinding(discriminator.getExpression(), candidate.getNameNode()));
    if (parameter === undefined || call.getArguments()[0] === undefined || !sameBinding(call.getArguments()[0]!, parameter.getNameNode())) return [];
    if (!unmodifiedBinding(parameter.getNameNode(), method.implementation)) return [];
    const prefix = key.getHead().getLiteralText();
    const suffix = span.getLiteral().getLiteralText();
    return prefix.length + suffix.length === 0 ? [] : [{ method, parameter, prefix, suffix, discriminator: discriminator.getName() }];
  });

const replays = (method: InstanceMethod, dispatch: Dispatch): boolean =>
  method.implementation.getDescendantsOfKind(SyntaxKind.ForOfStatement).some((loop) => {
    if (!belongsTo(loop, method)) return false;
    const collection = loop.getExpression();
    if (!method.implementation.getParameters().some((parameter) => sameBinding(collection, parameter.getNameNode()))) return false;
    if (!unaliasedCollection(collection, method.implementation)) return false;
    if (!collection.getType().isArray() && !collection.getType().isReadonlyArray()) return false;
    const initializer = loop.getInitializer();
    if (!Node.isVariableDeclarationList(initializer) || initializer.getDeclarationKind() !== VariableDeclarationKind.Const) return false;
    const bindings = initializer.getDeclarations();
    if (bindings.length !== 1) return false;
    const binding = bindings[0]!.getNameNode();
    if (!unmodifiedBinding(binding, loop.getStatement())) return false;
    const index = dispatch.method.implementation.getParameters().indexOf(dispatch.parameter);
    return loop.getStatement().getDescendantsOfKind(SyntaxKind.CallExpression).some((call) => {
      if (!belongsTo(call, method)) return false;
      const callee = call.getExpression();
      const argument = call.getArguments()[index];
      return Node.isPropertyAccessExpression(callee) && Node.isThisExpression(callee.getExpression()) &&
        callee.getName() === dispatch.method.name && argument !== undefined && sameBinding(argument, binding);
    });
  });

const discriminatorValue = (method: InstanceMethod, name: string, mutations: MemberMutations): { readonly value: string; readonly mutation: MutationEvidence } | undefined => {
  const parameters = method.implementation.getParameters();
  if (parameters.length !== 1) return undefined;
  const parameter = parameters[0]!;
  const declarations = parameter.getType().getProperty(name)?.getDeclarations() ?? [];
  if (declarations.length !== 1) return undefined;
  const property = declarations[0]!;
  if (!Node.isPropertyDeclaration(property)) return undefined;
  const mutation = mutations.evidenceOf(property);
  const initializer = property.getInitializer();
  if (Node.isStringLiteral(initializer)) return { value: initializer.getLiteralText(), mutation };
  if (!Node.isPropertyAccessExpression(initializer) || initializer.getName() !== 'name') return undefined;
  const owner = property.getParent();
  return Node.isClassDeclaration(owner) && !owner.getStaticMembers().some((member) => member.getName() === 'name') &&
    initializer.getExpression().getSymbol() === owner.getSymbol() && owner.getName() !== undefined ? { value: owner.getName()!, mutation } : undefined;
};

export const replayAppliers = (scope: AggregateScope, sources: SourceIndex, uses: NameUses, mutations: MemberMutations): ReadonlyMap<string, EntryPoint> => {
  const chain = sourceChain(scope.cls, sources);
  const names = [...new Set(chain.flatMap((cls) => cls.getInstanceMethods().map((method) => method.getName())))];
  const methods = names.flatMap((name) => resolveInstanceMethod(chain, name, scope) ?? []);
  const candidates = methods.flatMap(dispatches);
  const roles = new Map<string, EntryPoint>();
  for (const method of methods) {
    if (uses.isReferenced(method.name)) continue;
    for (const candidate of candidates) {
      const discriminator = discriminatorValue(method, candidate.discriminator, mutations);
      if (discriminator === undefined || method.name !== candidate.prefix + discriminator.value + candidate.suffix) continue;
      for (const replay of methods.filter((possible) => replays(possible, candidate))) {
        const mutation = mergedMutationEvidence([
          mutations.evidenceOf(candidate.method.member), mutations.evidenceOf(replay.member), discriminator.mutation,
        ]);
        if (mutation === 'other') continue;
        if (mutation === 'none') roles.set(method.name, 'replay');
        else if ((mutation === 'conditional-copy' || mutation === 'unresolved-delegate') && !roles.has(method.name)) roles.set(method.name, 'unknown');
      }
    }
  }
  return roles;
};
