import { Node, SyntaxKind } from 'ts-morph';
import { isAssignmentOperator } from './assigned';
import { Bookkeeping, isAuditWrite, isBookkeepingAssignment, isBookkeepingCollectionCall } from './bookkeeping';
import { isRootedAtThis } from './field-ref';
import { InstanceMethod, MethodImplementation } from './instance-method';

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

const assignsThis = (implementation: MethodImplementation, bookkeeping: Bookkeeping): boolean =>
  implementation
    .getDescendantsOfKind(SyntaxKind.BinaryExpression)
    .some(
      (binary) => isAssignmentOperator(binary) && isRootedAtThis(binary.getLeft()) && !isBookkeepingAssignment(binary, bookkeeping),
    );

const incrementsThis = (implementation: MethodImplementation, bookkeeping: Bookkeeping): boolean =>
  [
    ...implementation.getDescendantsOfKind(SyntaxKind.PrefixUnaryExpression),
    ...implementation.getDescendantsOfKind(SyntaxKind.PostfixUnaryExpression),
  ].some(
    (unary) =>
      INCREMENTS.has(unary.getOperatorToken()) && isRootedAtThis(unary.getOperand()) && !isAuditWrite(unary.getOperand(), bookkeeping),
  );

const callsMutator = (
  implementation: MethodImplementation,
  eventMethods: ReadonlySet<string>,
  bookkeeping: Bookkeeping,
): boolean =>
  implementation.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) => {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) return false;
    const receiver = callee.getExpression();
    if (Node.isThisExpression(receiver)) return eventMethods.has(callee.getName());
    if (COLLECTION_MUTATORS.has(callee.getName()) && isRootedAtThis(receiver) && isCollection(receiver)) {
      return !isBookkeepingCollectionCall(receiver, bookkeeping);
    }
    const [target] = call.getArguments();
    return callee.getText() === 'Object.assign' && target !== undefined && isRootedAtThis(target);
  });

const calledThisMethods = (implementation: MethodImplementation): string[] =>
  implementation
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .map((call) => call.getExpression())
    .filter(Node.isPropertyAccessExpression)
    .filter((callee) => Node.isThisExpression(callee.getExpression()))
    .map((callee) => callee.getName());

const closeOverCalls = (methods: readonly InstanceMethod[], mutating: ReadonlySet<string>): ReadonlySet<string> => {
  const next = new Set([
    ...mutating,
    ...methods
      .filter((method) => calledThisMethods(method.implementation).some((name) => mutating.has(name)))
      .map((method) => method.name),
  ]);
  return next.size === mutating.size ? mutating : closeOverCalls(methods, next);
};

const isDirectlyMutating = (
  implementation: MethodImplementation,
  eventMethods: ReadonlySet<string>,
  bookkeeping: Bookkeeping,
): boolean =>
  assignsThis(implementation, bookkeeping) ||
  incrementsThis(implementation, bookkeeping) ||
  callsMutator(implementation, eventMethods, bookkeeping);

export const mutatingMethods = (
  methods: readonly InstanceMethod[],
  eventMethods: readonly string[],
  bookkeeping: Bookkeeping,
): ReadonlySet<string> => {
  const events = new Set(eventMethods);
  const direct = new Set(
    methods
      .filter(({ implementation }) => isDirectlyMutating(implementation, events, bookkeeping))
      .map((method) => method.name),
  );
  return closeOverCalls(methods, direct);
};
