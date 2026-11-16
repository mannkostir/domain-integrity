import { ClassDeclaration, Expression, Node, SyntaxKind } from 'ts-morph';
import { isDefaultLibraryNode } from '../shared/library';
import { SourceIndex } from '../shared/source-index';
import { isWritten } from '../shared/writes';
import { outermostWrapper, unwrap } from '../shared/wrappers';
import { AggregateScope, MAX_GETTER_DEPTH, fieldNameOf, hasForeignThis, isJavaScriptScalarValue, isTrackedDataRead, scalarCallable } from './field-ref';
import { isTrackedDataDestination } from './state-assignment';
import { resolveStateField } from './state-field';
import { StateField } from './model';
import { ScalarDependencyFacts } from './scalar-dependencies';
import { ScalarDispatchFacts } from './scalar-dispatch';
import { Subclasses } from './subclasses';

export class ScalarCallableFacts {
  private readonly dispatch: ScalarDispatchFacts;
  private readonly dependencies: ScalarDependencyFacts;
  constructor(sources: SourceIndex, subclasses: Subclasses) {
    this.dispatch = new ScalarDispatchFacts(sources, subclasses);
    this.dependencies = new ScalarDependencyFacts(sources);
  }
  enumMember(node: Node): boolean { return this.dependencies.enumMember(node); }
  includesStable(): boolean { return this.dependencies.includesStable(); }

  stable(cls: ClassDeclaration): boolean { return this.dispatch.stable(cls); }
}

const OPERATORS = new Set([
  SyntaxKind.AmpersandAmpersandToken, SyntaxKind.BarBarToken,
  SyntaxKind.EqualsEqualsEqualsToken, SyntaxKind.ExclamationEqualsEqualsToken,
  SyntaxKind.EqualsEqualsToken, SyntaxKind.ExclamationEqualsToken,
]);

const primitiveLiteral = (node: Node): boolean =>
  Node.isTrueLiteral(node) || Node.isFalseLiteral(node) || Node.isNullLiteral(node) ||
  Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node) || Node.isNumericLiteral(node) || Node.isBigIntLiteral(node) ||
  (Node.isIdentifier(node) && node.getText() === 'undefined' && node.getType().isUndefined() &&
    (node.getSymbol()?.getDeclarations() ?? []).every(isDefaultLibraryNode));

type ScalarUse = 'scalar' | 'condition' | 'nullish';

const unparenthesized = (node: Expression): Expression =>
  Node.isParenthesizedExpression(node) ? unparenthesized(node.getExpression()) : node;

export class ScalarReturnProof {
  private remaining = 256;
  private exhausted = false;
  private failed = false;
  private readonly expressions = new Map<Node, ReadonlyMap<ScalarUse, Expression>>();
  private readonly dataReads = new Set<Node>();
  constructor(private readonly field: StateField, private readonly scope: AggregateScope) {}
  take(): boolean {
    if (this.remaining-- <= 0) this.exhausted = true;
    return !this.exhausted && !this.failed;
  }
  valid(): boolean { return !this.exhausted && !this.failed; }
  expression(node: Node, use: ScalarUse = 'scalar'): Expression | undefined { return this.valid() ? this.expressions.get(node)?.get(use) : undefined; }
  hasDataRead(node: Node): boolean { return [node, ...node.getDescendants()].some(candidate => this.dataReads.has(candidate)); }
  expand(node: Node, use: ScalarUse = 'scalar'): Expression | undefined {
    if (!this.proveCallable(node, new Set(), 0, use)) {
      this.failed = true;
      return undefined;
    }
    return this.expression(node, use);
  }
  normalize(node: Expression, use: ScalarUse = 'scalar'): Expression | undefined {
    if (!this.take()) return undefined;
    if (Node.isParenthesizedExpression(node)) return this.normalize(node.getExpression(), use);
    const expression = this.expression(node, use);
    if (expression !== undefined) return this.normalize(expression, use);
    if (this.scope.projections?.scalar(node, this.field.name)) return node;
    if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
      if (node.hasQuestionDotToken() || hasForeignThis(node) || isWritten(outermostWrapper(node))) return undefined;
      const name = fieldNameOf(node);
      if (isTrackedDataRead(node, this.field.name, this.scope) ||
        (name !== undefined && isTrackedDataDestination(node, name, this.scope.cls, this.scope.javascriptData))) return node;
      const declarations = Node.isPropertyAccessExpression(node) ? node.getNameNode().getSymbol()?.getDeclarations() ?? [] : [];
      if (declarations.length > 0 && declarations.every(Node.isEnumMember)) return node;
      const returned = this.expand(node, use);
      return returned === undefined ? undefined : this.normalize(returned, use);
    }
    if (Node.isAsExpression(node) || Node.isTypeAssertion(node) || Node.isSatisfiesExpression(node) || Node.isNonNullExpression(node)) {
      const inner = node.getExpression();
      const normalized = this.normalize(inner, use);
      return normalized !== undefined && normalized === unparenthesized(inner) ? node : undefined;
    }
    if (primitiveLiteral(node) || Node.isIdentifier(node)) return node;
    return Node.isPrefixUnaryExpression(node) &&
      (node.getOperatorToken() === SyntaxKind.MinusToken || node.getOperatorToken() === SyntaxKind.PlusToken) &&
      Node.isNumericLiteral(node.getOperand()) ? node : undefined;
  }
  private proveCallable(node: Node, visited: ReadonlySet<Node>, depth: number, use: ScalarUse): boolean {
    if (!this.take() || depth >= MAX_GETTER_DEPTH) return false;
    const callable = scalarCallable(node, this.scope);
    if (callable === undefined || this.scope.leaksThis || visited.has(callable.identity) || !this.scope.scalarCallables.stable(this.scope.cls)) return false;
    const next = new Set([...visited, callable.identity]);
    if (!this.prove(callable.expression, next, depth + 1, use)) return false;
    this.expressions.set(node, new Map([...(this.expressions.get(node) ?? []), [use, callable.expression]]));
    return true;
  }
  private operand(node: Expression, use: ScalarUse): Expression | undefined {
    if (!this.take()) return undefined;
    if (Node.isParenthesizedExpression(node)) return this.operand(node.getExpression(), use);
    const expression = this.expression(node, use);
    return expression === undefined ? node : this.operand(expression, use);
  }
  private nullish(node: Expression): boolean {
    return Node.isNullLiteral(node) || (Node.isIdentifier(node) && node.getText() === 'undefined' && primitiveLiteral(node));
  }
  private proveComparison(left: Expression, right: Expression, visited: ReadonlySet<Node>, depth: number): boolean {
    if (!this.prove(left, visited, depth, 'nullish') || !this.prove(right, visited, depth, 'nullish')) return false;
    const leftValue = this.operand(left, 'nullish');
    const rightValue = this.operand(right, 'nullish');
    return leftValue !== undefined && rightValue !== undefined &&
      ((isJavaScriptScalarValue(leftValue.getType()) && isJavaScriptScalarValue(rightValue.getType())) ||
        this.nullish(leftValue) || this.nullish(rightValue));
  }
  private prove(node: Node, visited: ReadonlySet<Node>, depth: number, use: ScalarUse): boolean {
    if (!this.take()) return false;
    if (primitiveLiteral(node) || this.scope.scalarCallables.enumMember(node)) return true;
    if (this.scope.projections?.scalar(node, this.field.name)) {
      this.dataReads.add(node);
      return true;
    }
    if (Node.isParenthesizedExpression(node)) return this.prove(node.getExpression(), visited, depth, use);
    if (Node.isPrefixUnaryExpression(node)) {
      const operator = node.getOperatorToken();
      return operator === SyntaxKind.ExclamationToken
        ? this.prove(node.getOperand(), visited, depth, 'condition')
        : operator === SyntaxKind.MinusToken && Node.isNumericLiteral(node.getOperand());
    }
    if (Node.isBinaryExpression(node)) {
      const operator = node.getOperatorToken().getKind();
      if (!OPERATORS.has(operator)) return false;
      if (operator === SyntaxKind.AmpersandAmpersandToken || operator === SyntaxKind.BarBarToken) {
        const branchUse = use === 'condition' ? 'condition' : 'scalar';
        return this.prove(node.getLeft(), visited, depth, branchUse) && this.prove(node.getRight(), visited, depth, branchUse);
      }
      return this.proveComparison(node.getLeft(), node.getRight(), visited, depth);
    }
    if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
      if (node.hasQuestionDotToken() || hasForeignThis(node) || isWritten(outermostWrapper(node))) return false;
      const name = fieldNameOf(node);
      if (name !== undefined && (name === this.field.name || resolveStateField(this.scope.cls, name).kind === 'resolved') && (isJavaScriptScalarValue(node.getType()) ||
        (use !== 'scalar' && name === this.field.name && this.field.kind === 'nullable')) &&
        isTrackedDataDestination(node, name, this.scope.cls, this.scope.javascriptData)) {
        this.dataReads.add(node);
        return true;
      }
      return this.proveCallable(node, visited, depth, use);
    }
    if (!Node.isCallExpression(node) || node.hasQuestionDotToken() || node.getTypeArguments().length > 0) return false;
    const callee = node.getExpression();
    if (Node.isPropertyAccessExpression(callee) && !callee.hasQuestionDotToken() && callee.getName() === 'includes') {
      const receiver = unwrap(callee.getExpression());
      const declarations = callee.getNameNode().getSymbol()?.getDeclarations() ?? [];
      const arguments_ = node.getArguments();
      return this.scope.scalarCallables.includesStable() && Node.isArrayLiteralExpression(receiver) && declarations.length > 0 && declarations.every(isDefaultLibraryNode) &&
        receiver.getElements().every(element => this.prove(element, visited, depth, 'scalar')) &&
        arguments_.length === 1 && arguments_[0] !== undefined && this.prove(arguments_[0], visited, depth, 'scalar');
    }
    return this.proveCallable(node, visited, depth, use);
  }
}
