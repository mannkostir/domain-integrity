import { ClassDeclaration, Expression, Node, SyntaxKind } from 'ts-morph';
import { isDefaultLibraryNode } from '../shared/library';
import { SourceIndex } from '../shared/source-index';
import { isWritten } from '../shared/writes';
import { outermostWrapper, unwrap } from '../shared/wrappers';
import { AggregateScope, MAX_GETTER_DEPTH, fieldNameOf, hasForeignThis, isJavaScriptScalarValue, scalarCallable } from './field-ref';
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

export class ScalarReturnProof {
  private remaining = 256;
  private exhausted = false;
  private readonly expressions = new Map<Node, Expression>();
  private readonly dataReads = new Set<Node>();
  constructor(private readonly field: StateField, private readonly scope: AggregateScope) {}
  take(): boolean {
    if (this.remaining-- <= 0) this.exhausted = true;
    return !this.exhausted;
  }
  expression(node: Node): Expression | undefined { return this.expressions.get(node); }
  hasDataRead(node: Node): boolean { return [node, ...node.getDescendants()].some(candidate => this.dataReads.has(candidate)); }
  expand(node: Node): Expression | undefined {
    if (!this.proveCallable(node, new Set(), 0)) return undefined;
    return this.exhausted ? undefined : this.expression(node);
  }
  private proveCallable(node: Node, visited: ReadonlySet<Node>, depth: number): boolean {
    if (!this.take() || depth >= MAX_GETTER_DEPTH) return false;
    const callable = scalarCallable(node, this.scope);
    if (callable === undefined || this.scope.leaksThis || visited.has(callable.identity) || !this.scope.scalarCallables.stable(this.scope.cls)) return false;
    const next = new Set([...visited, callable.identity]);
    if (!this.prove(callable.expression, next, depth + 1)) return false;
    this.expressions.set(node, callable.expression);
    return true;
  }
  private prove(node: Node, visited: ReadonlySet<Node>, depth: number): boolean {
    if (!this.take()) return false;
    if (primitiveLiteral(node) || this.scope.scalarCallables.enumMember(node)) return true;
    if (Node.isParenthesizedExpression(node)) return this.prove(node.getExpression(), visited, depth);
    if (Node.isPrefixUnaryExpression(node)) {
      const operator = node.getOperatorToken();
      return operator === SyntaxKind.ExclamationToken
        ? this.prove(node.getOperand(), visited, depth)
        : operator === SyntaxKind.MinusToken && Node.isNumericLiteral(node.getOperand());
    }
    if (Node.isBinaryExpression(node)) return OPERATORS.has(node.getOperatorToken().getKind()) &&
      this.prove(node.getLeft(), visited, depth) && this.prove(node.getRight(), visited, depth);
    if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
      if (node.hasQuestionDotToken() || hasForeignThis(node) || isWritten(outermostWrapper(node))) return false;
      const name = fieldNameOf(node);
      if (name !== undefined && (name === this.field.name || resolveStateField(this.scope.cls, name).kind === 'resolved') && isJavaScriptScalarValue(node.getType()) &&
        isTrackedDataDestination(node, name, this.scope.cls, this.scope.javascriptData)) {
        this.dataReads.add(node);
        return true;
      }
      return this.proveCallable(node, visited, depth);
    }
    if (!Node.isCallExpression(node) || node.hasQuestionDotToken() || node.getTypeArguments().length > 0) return false;
    const callee = node.getExpression();
    if (Node.isPropertyAccessExpression(callee) && !callee.hasQuestionDotToken() && callee.getName() === 'includes') {
      const receiver = unwrap(callee.getExpression());
      const declarations = callee.getNameNode().getSymbol()?.getDeclarations() ?? [];
      const arguments_ = node.getArguments();
      return this.scope.scalarCallables.includesStable() && Node.isArrayLiteralExpression(receiver) && declarations.length > 0 && declarations.every(isDefaultLibraryNode) &&
        receiver.getElements().every(element => this.prove(element, visited, depth)) &&
        arguments_.length === 1 && arguments_[0] !== undefined && this.prove(arguments_[0], visited, depth);
    }
    return this.proveCallable(node, visited, depth);
  }
}
