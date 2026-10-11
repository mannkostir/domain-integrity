import { Expression, Node, SyntaxKind, Type } from 'ts-morph';
import { SourceIndex } from '../../shared/source-index';
import { unwrap } from '../../shared/wrappers';
import { CalleeReach, calleeReach } from './escaping-callee';
import { FamilyHolding, Holds } from './family-type';
import { isPrivateMember } from './private-member';

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

const isPrivateProperty = (declaration: Node): boolean => Node.isPropertyDeclaration(declaration) && isPrivateMember(declaration);

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

const escapesThroughInvocations = (production: SourceIndex, holding: FamilyHolding): boolean =>
  production
    .ofKind(SyntaxKind.CallExpression)
    .some((call) => escapesThroughInvocation(call.getExpression(), call.getArguments(), holding)) ||
  production
    .ofKind(SyntaxKind.NewExpression)
    .some((expression) => escapesThroughInvocation(expression.getExpression(), expression.getArguments(), holding)) ||
  production
    .ofKind(SyntaxKind.TaggedTemplateExpression)
    .some((tagged) => escapesThroughInvocation(tagged.getTag(), templateArguments(tagged.getTemplate()), holding));

const escapesThroughSurfaceReads = (production: SourceIndex, atSurface: Holds): boolean =>
  production
    .ofKind(SyntaxKind.ElementAccessExpression)
    .some((access) => !isLiteralKey(access.getArgumentExpression()) && atSurface(access.getExpression().getType())) ||
  production.ofKind(SyntaxKind.SpreadAssignment).some((spread) => atSurface(spread.getExpression().getType())) ||
  production.ofKind(SyntaxKind.ForInStatement).some((loop) => atSurface(loop.getExpression().getType()));

const escapesThroughValues = (production: SourceIndex, holding: FamilyHolding): boolean =>
  escapesThroughInvocations(production, holding) ||
  escapesThroughSurfaceReads(production, holding.holdsAtSurface) ||
  production
    .ofKind(SyntaxKind.SpreadElement)
    .some((spread) => escapesThroughArraySpread(spread.getExpression(), holding.holdsInstance));

const escapesThroughCasts = (production: SourceIndex, holding: FamilyHolding): boolean =>
  production.ofKind(SyntaxKind.AsExpression).some((cast) => escapesThroughCast(cast, holding)) ||
  production.ofKind(SyntaxKind.TypeAssertionExpression).some((cast) => escapesThroughCast(cast, holding));

export const hasEscapeRoute = (production: SourceIndex, holding: FamilyHolding): boolean =>
  escapesThroughValues(production, holding) || escapesThroughCasts(production, holding);
