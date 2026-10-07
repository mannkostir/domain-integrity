import { Expression, Node, SourceFile, SyntaxKind, Type } from 'ts-morph';
import { unwrap } from '../../shared/wrappers';
import { CalleeReach, calleeReach } from './escaping-callee';
import { FamilyHolding } from './family-type';

type Holds = (type: Type) => boolean;

const anyHolds = (nodes: readonly Node[], holds: Holds): boolean => nodes.some((node) => holds(node.getType()));

const NEVER: Holds = () => false;

const holdsForReach = (reach: CalleeReach, holding: FamilyHolding): Holds =>
  ({ none: NEVER, surface: holding.holdsAtSurface, deep: holding.holdsInstance })[reach];

const escapesThroughInvocation = (callee: Node, args: readonly Node[], holding: FamilyHolding): boolean =>
  anyHolds(args, holding.holdsInstance) && anyHolds(args, holdsForReach(calleeReach(callee), holding));

const isArrayLike = (type: Type): boolean => type.isArray() || type.isReadonlyArray() || type.isTuple();

const templateArguments = (template: Node): readonly Node[] =>
  Node.isTemplateExpression(template) ? template.getTemplateSpans().map((span) => span.getExpression()) : [];

const isLiteralKey = (key: Node | undefined): boolean =>
  Node.isStringLiteral(key) || Node.isNumericLiteral(key) || Node.isNoSubstitutionTemplateLiteral(key);

const isPrivateProperty = (declaration: Node): boolean =>
  Node.isPropertyDeclaration(declaration) && declaration.hasModifier(SyntaxKind.PrivateKeyword);

const isOwnPrivateField = (expression: Expression, holds: Holds): boolean => {
  const target = unwrap(expression);
  if (!Node.isPropertyAccessExpression(target)) return false;
  const receiver = unwrap(target.getExpression());
  return (
    Node.isThisExpression(receiver) &&
    holds(receiver.getType()) &&
    (target.getSymbol()?.getDeclarations() ?? []).some(isPrivateProperty)
  );
};

const escapesThroughArraySpread = (expression: Expression, holds: Holds): boolean =>
  !isArrayLike(expression.getType()) && !isOwnPrivateField(expression, holds) && holds(expression.getType());

const escapesThroughCast = (cast: Expression, holding: FamilyHolding): boolean =>
  holding.holdsInstance(unwrap(cast).getType()) && !holding.holdsInstance(cast.getType());

const escapesThroughInvocations = (file: SourceFile, holding: FamilyHolding): boolean =>
  file
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .some((call) => escapesThroughInvocation(call.getExpression(), call.getArguments(), holding)) ||
  file
    .getDescendantsOfKind(SyntaxKind.NewExpression)
    .some((expression) => escapesThroughInvocation(expression.getExpression(), expression.getArguments(), holding)) ||
  file
    .getDescendantsOfKind(SyntaxKind.TaggedTemplateExpression)
    .some((tagged) => escapesThroughInvocation(tagged.getTag(), templateArguments(tagged.getTemplate()), holding));

const escapesThroughSurfaceReads = (file: SourceFile, atSurface: Holds): boolean =>
  file
    .getDescendantsOfKind(SyntaxKind.ElementAccessExpression)
    .some((access) => !isLiteralKey(access.getArgumentExpression()) && atSurface(access.getExpression().getType())) ||
  file.getDescendantsOfKind(SyntaxKind.SpreadAssignment).some((spread) => atSurface(spread.getExpression().getType())) ||
  file.getDescendantsOfKind(SyntaxKind.ForInStatement).some((loop) => atSurface(loop.getExpression().getType()));

const escapesThroughValues = (file: SourceFile, holding: FamilyHolding): boolean =>
  escapesThroughInvocations(file, holding) ||
  escapesThroughSurfaceReads(file, holding.holdsAtSurface) ||
  file
    .getDescendantsOfKind(SyntaxKind.SpreadElement)
    .some((spread) => escapesThroughArraySpread(spread.getExpression(), holding.holdsInstance));

const escapesThroughCasts = (file: SourceFile, holding: FamilyHolding): boolean =>
  file.getDescendantsOfKind(SyntaxKind.AsExpression).some((cast) => escapesThroughCast(cast, holding)) ||
  file.getDescendantsOfKind(SyntaxKind.TypeAssertionExpression).some((cast) => escapesThroughCast(cast, holding));

export const hasEscapeRoute = (production: readonly SourceFile[], holding: FamilyHolding): boolean =>
  production.some((file) => escapesThroughValues(file, holding) || escapesThroughCasts(file, holding));
