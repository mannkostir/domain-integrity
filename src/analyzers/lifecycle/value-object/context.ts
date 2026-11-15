import { literalToken } from '../../../engine/value-token';
import { PredicateBudget } from './predicate-budget';
import { predicateEnumLiteral } from './predicate-operands';
import { CallExpression, ClassDeclaration, Expression, Node, SyntaxKind } from 'ts-morph';
import { SourceIndex } from '../../shared/source-index';
import { unwrap } from '../../shared/wrappers';
import { isWritten } from '../../shared/writes';
import { fieldNameOf, hasForeignThis, inheritanceChain } from '../field-ref';
import { isPlainDataPathFromThis, isTrackedDataDestination, setterStateAssignment } from '../state-assignment';
import { StateField } from '../model';
import { assignedToken, UNRESOLVED } from '../values';
import { ScalarProjection, ProjectionProof } from './model';
import { proveScalarProjection } from './projection';
import { mapProjectedValue } from './assigned-value';
import { proveWrapperPredicate, wrapperPredicateSources } from './predicate';
import { ObservableProjection, observeProjection } from './observable';

export class ProjectionRegistry {
  private readonly proofs = new Map<Node, ProjectionProof>();
  private readonly observations = new Map<ScalarProjection, ObservableProjection>();
  constructor(private readonly sources: SourceIndex, private readonly aggregates: readonly ClassDeclaration[] = []) {}
  field(cls: ClassDeclaration, name: string): ScalarProjection | undefined {
    const symbol = cls.getType().getProperty(name) ?? cls.getType().getProperty('props')?.getTypeAtLocation(cls).getProperty(name);
    if (symbol === undefined) return undefined;
    const type = symbol.getTypeAtLocation(cls);
    if (type.isUnion() || type.isAny() || type.isUnknown()) return undefined;
    const declaration = type.getSymbol()?.getDeclarations()[0];
    if (!Node.isClassDeclaration(declaration)) return undefined;
    let proof = this.proofs.get(declaration);
    if (proof === undefined) {
      proof = proveScalarProjection(type);
      this.proofs.set(declaration, proof);
    }
    return proof.kind === 'proven' ? proof.projection : undefined;
  }
  observation(projection: ScalarProjection): ObservableProjection {
    let observation = this.observations.get(projection);
    if (observation === undefined) {
      observation = observeProjection(projection, this.sources, this.aggregates);
      this.observations.set(projection, observation);
    }
    return observation;
  }
}

export class ProjectedFields {
  constructor(private readonly cls: ClassDeclaration, private readonly registry: ProjectionRegistry) {}
  projection(name: string): ScalarProjection | undefined { return this.registry.field(this.cls, name); }
  admitted(name: string): boolean {
    const projection = this.projection(name);
    return projection === undefined || this.registry.observation(projection).admitted;
  }
  receiver(node: Node, name: string): boolean {
    if (this.projection(name) === undefined || hasForeignThis(node)) return false;
    const target = unwrap(node);
    if (fieldNameOf(target) !== name || !isPlainDataPathFromThis(target)) return false;
    const root = [target, ...target.getDescendants()].find(Node.isThisExpression);
    if (root === undefined || root.getType().getConstructSignatures().length > 0 ||
        !(root.getType().getSymbol()?.getDeclarations() ?? []).some(declaration => Node.isClassDeclaration(declaration) && inheritanceChain(this.cls).includes(declaration))) return false;
    if (isTrackedDataDestination(target, name, this.cls)) return true;
    if (!Node.isPropertyAccessExpression(target)) return false;
    const holder = unwrap(target.getExpression());
    if (!Node.isPropertyAccessExpression(holder) || !Node.isThisExpression(unwrap(holder.getExpression())) || holder.getName() !== 'props') return false;
    const selectedHolder = this.cls.getType().getProperty('props');
    const selected = selectedHolder?.getTypeAtLocation(this.cls).getProperty(name);
    const sameDeclarations = (expected: readonly Node[], actual: readonly Node[]): boolean =>
      expected.length > 0 && expected.length === actual.length && expected.every(declaration => actual.includes(declaration));
    return sameDeclarations(selectedHolder?.getDeclarations() ?? [], holder.getNameNode().getSymbol()?.getDeclarations() ?? []) &&
      sameDeclarations(selected?.getDeclarations() ?? [], target.getNameNode().getSymbol()?.getDeclarations() ?? []);
  }
  tracksTarget = (node: Node, field: StateField): boolean => {
    if (this.projection(field.name) === undefined) return true;
    if (fieldNameOf(node) === field.name) return this.receiver(node, field.name);
    const parent = node.getParent();
    if (!Node.isBinaryExpression(parent) || setterStateAssignment(parent, field.name, this.cls) === undefined) return true;
    const root = [node, ...node.getDescendants()].find(Node.isThisExpression);
    return !hasForeignThis(node) && root !== undefined && root.getType().getConstructSignatures().length === 0 &&
      (root.getType().getSymbol()?.getDeclarations() ?? []).some(declaration =>
        Node.isClassDeclaration(declaration) && inheritanceChain(this.cls).includes(declaration));
  };
  scalar(node: Node, name: string): boolean {
    const projection = this.projection(name);
    if (projection === undefined || !this.admitted(name) || !Node.isPropertyAccessExpression(node) || node.hasQuestionDotToken() || isWritten(node)) return false;
    const declarations = node.getNameNode().getSymbol()?.getDeclarations() ?? [];
    return declarations.length === 1 && declarations[0] === projection.getter && this.receiver(node.getExpression(), name);
  }
  literal(node: Expression, name: string): string | undefined {
    const projection = this.projection(name);
    if (projection === undefined || !this.admitted(name)) return undefined;
    const value = unwrap(node);
    if (Node.isStringLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value) || Node.isNumericLiteral(value) ||
        (Node.isPrefixUnaryExpression(value) && value.getOperatorToken() === SyntaxKind.MinusToken && Node.isNumericLiteral(value.getOperand()))) {
      const token = literalToken(value.getType());
      return projection.values.some(known => known.token === token) ? token : undefined;
    }
    const read = predicateEnumLiteral(value, projection, new PredicateBudget());
    return read.kind === 'known' ? read.value.token : undefined;
  }
  predicate(call: CallExpression, field: StateField) {
    const projection = this.projection(field.name);
    const member = call.getExpression();
    if (projection === undefined || !this.admitted(field.name) || !Node.isPropertyAccessExpression(member) || member.hasQuestionDotToken() ||
        call.hasQuestionDotToken() || !this.receiver(member.getExpression(), field.name)) return 'unknown' as const;
    const declarations = member.getNameNode().getSymbol()?.getDeclarations() ?? [];
    const method = declarations.length === 1 ? declarations[0] : undefined;
    if (!Node.isMethodDeclaration(method)) return 'unknown' as const;
    const proof = proveWrapperPredicate(method, projection);
    if (proof.kind === 'unknown') return 'unknown' as const;
    const arguments_ = call.getArguments();
    if (!arguments_.every(Node.isExpression)) return 'unknown' as const;
    const sources = wrapperPredicateSources(proof.predicate, arguments_);
    return sources.kind === 'unknown' ? 'unknown' as const : sources;
  }
  assigned = (value: Expression, field: StateField) => {
    const projection = this.projection(field.name);
    if (projection === undefined) return undefined;
    if (!this.admitted(field.name)) return UNRESOLVED;
    const result = mapProjectedValue(value, projection);
    return result.kind === 'known' ? assignedToken(result.token) : UNRESOLVED;
  };
}
