import { Expression, Node, SourceFile, SyntaxKind, Type } from 'ts-morph';
import { unwrap } from '../../shared/wrappers';
import { isEscapingCallee } from './escaping-callee';
import { FamilyHolding } from './family-type';

type MayHold = (type: Type) => boolean;

const anyHolds = (nodes: readonly Node[], mayHold: MayHold): boolean => nodes.some((node) => mayHold(node.getType()));

const escapesThroughInvocation = (callee: Node, args: readonly Node[], mayHold: MayHold): boolean =>
  isEscapingCallee(callee) && anyHolds(args, mayHold);

const templateArguments = (template: Node): readonly Node[] =>
  Node.isTemplateExpression(template) ? template.getTemplateSpans().map((span) => span.getExpression()) : [];

const isLiteralKey = (key: Node | undefined): boolean =>
  Node.isStringLiteral(key) || Node.isNumericLiteral(key) || Node.isNoSubstitutionTemplateLiteral(key);

const isPrivateProperty = (declaration: Node): boolean =>
  Node.isPropertyDeclaration(declaration) && declaration.hasModifier(SyntaxKind.PrivateKeyword);

const isOwnPrivateField = (expression: Expression, mayHold: MayHold): boolean => {
  const target = unwrap(expression);
  if (!Node.isPropertyAccessExpression(target)) return false;
  const receiver = unwrap(target.getExpression());
  return (
    Node.isThisExpression(receiver) &&
    mayHold(receiver.getType()) &&
    (target.getSymbol()?.getDeclarations() ?? []).some(isPrivateProperty)
  );
};

const escapesThroughArraySpread = (expression: Expression, mayHold: MayHold): boolean =>
  !isOwnPrivateField(expression, mayHold) && mayHold(expression.getType());

const escapesThroughCast = (cast: Expression, holding: FamilyHolding): boolean =>
  holding.holdsInstance(unwrap(cast).getType()) && !holding.mayHold(cast.getType());

const escapesThroughValues = (file: SourceFile, mayHold: MayHold): boolean =>
  file
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .some((call) => escapesThroughInvocation(call.getExpression(), call.getArguments(), mayHold)) ||
  file
    .getDescendantsOfKind(SyntaxKind.NewExpression)
    .some((expression) => escapesThroughInvocation(expression.getExpression(), expression.getArguments(), mayHold)) ||
  file
    .getDescendantsOfKind(SyntaxKind.TaggedTemplateExpression)
    .some((tagged) => escapesThroughInvocation(tagged.getTag(), templateArguments(tagged.getTemplate()), mayHold)) ||
  file
    .getDescendantsOfKind(SyntaxKind.ElementAccessExpression)
    .some((access) => !isLiteralKey(access.getArgumentExpression()) && mayHold(access.getExpression().getType())) ||
  file.getDescendantsOfKind(SyntaxKind.SpreadAssignment).some((spread) => mayHold(spread.getExpression().getType())) ||
  file
    .getDescendantsOfKind(SyntaxKind.SpreadElement)
    .some((spread) => escapesThroughArraySpread(spread.getExpression(), mayHold)) ||
  file.getDescendantsOfKind(SyntaxKind.ForInStatement).some((loop) => mayHold(loop.getExpression().getType()));

const escapesThroughCasts = (file: SourceFile, holding: FamilyHolding): boolean =>
  file.getDescendantsOfKind(SyntaxKind.AsExpression).some((cast) => escapesThroughCast(cast, holding)) ||
  file.getDescendantsOfKind(SyntaxKind.TypeAssertionExpression).some((cast) => escapesThroughCast(cast, holding));

export const hasEscapeRoute = (production: readonly SourceFile[], holding: FamilyHolding): boolean =>
  production.some((file) => escapesThroughValues(file, holding.mayHold) || escapesThroughCasts(file, holding));
