import { CallExpression, Node, SourceFile, SyntaxKind } from 'ts-morph';
import { bracketWritesOf, isKeyFor, isWritten } from '../../shared/writes';
import { outermostWrapper, unwrap } from '../../shared/wrappers';
import { BufferCandidate } from './buffer-candidate';

const KEYED_INSTALLERS: ReadonlySet<string> = new Set(['defineProperty']);
const LITERAL_INSTALLERS: ReadonlySet<string> = new Set(['assign', 'defineProperties']);

const calleeName = (call: CallExpression): string | undefined => {
  const callee = unwrap(call.getExpression());
  if (Node.isIdentifier(callee)) return callee.getText();
  return Node.isPropertyAccessExpression(callee) ? callee.getName() : undefined;
};

const declaresProperty = (argument: Node, name: string): boolean => {
  const literal = unwrap(argument);
  return Node.isObjectLiteralExpression(literal) && literal.getProperty(name) !== undefined;
};

const installs = (call: CallExpression, name: string): boolean => {
  const callee = calleeName(call) ?? '';
  const [, key] = call.getArguments();
  return (
    (KEYED_INSTALLERS.has(callee) && isKeyFor(key, name)) ||
    (LITERAL_INSTALLERS.has(callee) && call.getArguments().some((argument) => declaresProperty(argument, name)))
  );
};

const writesNamedProperty = (file: SourceFile, name: string): boolean =>
  file
    .getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)
    .some((access) => access.getName() === name && isWritten(outermostWrapper(access)));

const installsNamedProperty = (file: SourceFile, name: string): boolean =>
  file.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) => installs(call, name));

const isReassigned = (name: string, files: readonly SourceFile[]): boolean =>
  bracketWritesOf(name, files).length > 0 ||
  files.some((file) => writesNamedProperty(file, name) || installsNamedProperty(file, name));

export const hasReassignedPusher = (candidate: BufferCandidate, production: readonly SourceFile[]): boolean =>
  [...new Set(candidate.pushers.map((pusher) => pusher.getName()))].some((name) => isReassigned(name, production));
