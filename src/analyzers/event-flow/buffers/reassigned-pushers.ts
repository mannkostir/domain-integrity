import { CallExpression, Node, SyntaxKind } from 'ts-morph';
import { SourceIndex } from '../../shared/source-index';
import { BracketWrites, isKeyFor, isWritten } from '../../shared/writes';
import { outermostWrapper, unwrap } from '../../shared/wrappers';
import { BufferCandidate } from './buffer-candidate';

const KEYED_INSTALLERS: ReadonlySet<string> = new Set(['defineProperty']);
const LITERAL_INSTALLERS: ReadonlySet<string> = new Set(['assign', 'defineProperties']);

const calleeName = (call: CallExpression): string | undefined => {
  const callee = unwrap(call.getExpression());
  if (Node.isIdentifier(callee)) return callee.getText();
  return Node.isPropertyAccessExpression(callee) ? callee.getName() : undefined;
};

const isComputedKeyFor = (property: Node, name: string): boolean => {
  const key = Node.isPropertyNamed(property) ? property.getNameNode() : undefined;
  return Node.isComputedPropertyName(key) && isKeyFor(key.getExpression(), name);
};

const declaresProperty = (argument: Node, name: string): boolean => {
  const literal = unwrap(argument);
  return (
    Node.isObjectLiteralExpression(literal) &&
    (literal.getProperty(name) !== undefined || literal.getProperties().some((property) => isComputedKeyFor(property, name)))
  );
};

const installs = (call: CallExpression, name: string): boolean => {
  const callee = calleeName(call) ?? '';
  const [, key] = call.getArguments();
  return (
    (KEYED_INSTALLERS.has(callee) && isKeyFor(key, name)) ||
    (LITERAL_INSTALLERS.has(callee) && call.getArguments().some((argument) => declaresProperty(argument, name)))
  );
};

const writesNamedProperty = (production: SourceIndex, name: string): boolean =>
  production.propertyAccessesNamed(name).some((access) => isWritten(outermostWrapper(access)));

const installsNamedProperty = (production: SourceIndex, name: string): boolean =>
  production.ofKind(SyntaxKind.CallExpression).some((call) => installs(call, name));

const isReassigned = (name: string, production: SourceIndex, writes: BracketWrites): boolean =>
  writes.of(name).length > 0 || writesNamedProperty(production, name) || installsNamedProperty(production, name);

export const hasReassignedPusher = (candidate: BufferCandidate, production: SourceIndex, writes: BracketWrites): boolean =>
  [...new Set(candidate.pushers.map((pusher) => pusher.getName()))].some((name) => isReassigned(name, production, writes));
