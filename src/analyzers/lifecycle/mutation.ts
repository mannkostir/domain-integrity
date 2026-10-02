import { MethodDeclaration, Node, SyntaxKind } from 'ts-morph';
import { isAssignmentOperator } from './assigned';
import { isRootedAtThis } from './field-ref';

const COLLECTION_MUTATORS = new Set([
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
  'fill',
  'copyWithin',
  'set',
  'add',
  'delete',
  'clear',
]);

const COLLECTION_TYPES = new Set(['Array', 'Set', 'Map', 'WeakSet', 'WeakMap']);

const isCollection = (node: Node): boolean => {
  const type = node.getType().getNonNullableType();
  return type.isArray() || COLLECTION_TYPES.has(type.getSymbol()?.getName() ?? '');
};

const INCREMENTS = new Set<SyntaxKind>([SyntaxKind.PlusPlusToken, SyntaxKind.MinusMinusToken]);

const assignsThis = (method: MethodDeclaration): boolean =>
  method
    .getDescendantsOfKind(SyntaxKind.BinaryExpression)
    .some((binary) => isAssignmentOperator(binary) && isRootedAtThis(binary.getLeft()));

const incrementsThis = (method: MethodDeclaration): boolean =>
  [
    ...method.getDescendantsOfKind(SyntaxKind.PrefixUnaryExpression),
    ...method.getDescendantsOfKind(SyntaxKind.PostfixUnaryExpression),
  ].some((unary) => INCREMENTS.has(unary.getOperatorToken()) && isRootedAtThis(unary.getOperand()));

const callsMutator = (method: MethodDeclaration, eventMethods: ReadonlySet<string>): boolean =>
  method.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) => {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) return false;
    const receiver = callee.getExpression();
    if (Node.isThisExpression(receiver)) return eventMethods.has(callee.getName());
    if (COLLECTION_MUTATORS.has(callee.getName()) && isRootedAtThis(receiver) && isCollection(receiver)) return true;
    const [target] = call.getArguments();
    return callee.getText() === 'Object.assign' && target !== undefined && isRootedAtThis(target);
  });

const calledThisMethods = (method: MethodDeclaration): string[] =>
  method
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .map((call) => call.getExpression())
    .filter(Node.isPropertyAccessExpression)
    .filter((callee) => Node.isThisExpression(callee.getExpression()))
    .map((callee) => callee.getName());

const closeOverCalls = (methods: readonly MethodDeclaration[], mutating: ReadonlySet<string>): ReadonlySet<string> => {
  const next = new Set([
    ...mutating,
    ...methods
      .filter((method) => calledThisMethods(method).some((name) => mutating.has(name)))
      .map((method) => method.getName()),
  ]);
  return next.size === mutating.size ? mutating : closeOverCalls(methods, next);
};

export const mutatingMethods = (methods: readonly MethodDeclaration[], eventMethods: readonly string[]): ReadonlySet<string> => {
  const events = new Set(eventMethods);
  const direct = new Set(
    methods
      .filter((method) => assignsThis(method) || incrementsThis(method) || callsMutator(method, events))
      .map((method) => method.getName()),
  );
  return closeOverCalls(methods, direct);
};
