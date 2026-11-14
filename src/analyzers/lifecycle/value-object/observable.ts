import { originalExpressionType } from './original-type';
import { ProjectionFlows } from './implementation-flow';
import { StructuralWrites } from './structural-writes';
import { dependencyHazards } from './dependency-hazards';
import { isPlainDataPathFromThis, setterStateAssignment } from '../state-assignment';
import { ProjectionRecords, projectionReceiverType } from './receiver-types';
import { acceptsRecord, storesRecord } from './storage-boundary';
import { ClassDeclaration, Expression, Node, SyntaxKind } from 'ts-morph';
import { SourceIndex } from '../../shared/source-index';
import { isWritten } from '../../shared/writes';
import { outermostWrapper, unwrap } from '../../shared/wrappers';
import { declarationHazards } from './declaration-hazards';
import { ScalarProjection } from './model';
import { refersTo, simpleParameter } from './identity';
import { proveWrapperPredicate } from './predicate';
import { proveProjectedConstruction } from './assigned-value';

export type ObservableProjection = {
  readonly kind: 'observed';
  readonly scope: 'loaded-project-uses';
  readonly admitted: boolean;
  readonly reasons: readonly { readonly node: Node; readonly reason: string }[];
};

const isInstance = (node: Node, projection: ScalarProjection): boolean =>
  projectionReceiverType(node.getType(), projection) || projectionReceiverType(unwrap(node).getType(), projection) || projectionReceiverType(originalExpressionType(node), projection);

const inAncestry = (node: Node, ancestry: readonly Node[]): boolean =>
  node.getAncestors().some(ancestor => ancestry.includes(ancestor));

const isNameOrType = (node: Node): boolean => {
  const parent = node.getParent();
  return node.getAncestors().some(ancestor => Node.isTypeNode(ancestor) || Node.isImportDeclaration(ancestor) || Node.isExportDeclaration(ancestor)) ||
    ((Node.isPropertyAccessExpression(parent) || Node.isPropertyAssignment(parent) || Node.isMethodDeclaration(parent) ||
      Node.isGetAccessorDeclaration(parent) || Node.isSetAccessorDeclaration(parent) || Node.isTypeAliasDeclaration(parent) || Node.isEnumDeclaration(parent) || Node.isVariableDeclaration(parent) || Node.isParameterDeclaration(parent) ||
      Node.isPropertyDeclaration(parent) || Node.isPropertySignature(parent) || Node.isInterfaceDeclaration(parent) || Node.isClassDeclaration(parent)) && parent.getNameNode() === node);
};

const plainExposure = (node: Node): boolean => {
  const parent = node.getParent();
  if (!Node.isReturnStatement(parent)) return false;
  const getter = parent.getParentIfKind(SyntaxKind.Block)?.getParent();
  const body = Node.isGetAccessorDeclaration(getter) ? getter.getBody() : undefined;
  if (!Node.isBlock(body) || body.getStatements().length !== 1 || !Node.isPropertyAccessExpression(node)) return false;
  const receiver = node.getExpression();
  return Node.isThisExpression(receiver) || (Node.isPropertyAccessExpression(receiver) && Node.isThisExpression(receiver.getExpression()));
};

const isStoredConstruction = (node: Node, projection: ScalarProjection, aggregates: readonly ClassDeclaration[]): boolean => {
  if (!Node.isCallExpression(node) && !Node.isNewExpression(node)) return false;
  if (proveProjectedConstruction(node, projection).kind !== 'proven') return false;
  const parent = outermostWrapper(node).getParent();
  return Node.isPropertyAssignment(parent) || Node.isPropertyDeclaration(parent) ||
    (Node.isBinaryExpression(parent) && parent.getRight() === outermostWrapper(node) &&
      parent.getOperatorToken().getKind() === SyntaxKind.EqualsToken && (dataTarget(parent.getLeft()) || transparentReplacement(parent, projection, aggregates)));
};

const dataTarget = (target: Node): boolean => Node.isPropertyAccessExpression(target) &&
  (target.getSymbol()?.getDeclarations() ?? []).some(declaration => Node.isPropertySignature(declaration) || Node.isPropertyDeclaration(declaration));

const transparentReplacement = (binary: import('ts-morph').BinaryExpression, projection: ScalarProjection, aggregates: readonly ClassDeclaration[]): boolean => {
  const cls = binary.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
  if (cls === undefined || !aggregates.includes(cls)) return false;
  const own = cls.getType().getProperties();
  const props = cls.getType().getProperty('props')?.getTypeAtLocation(cls).getProperties() ?? [];
  return [...own, ...props].some(property => projectionReceiverType(property.getTypeAtLocation(cls), projection) &&
    setterStateAssignment(binary, property.getName(), cls) !== undefined);
};

const capturesBinding = (node: Node): boolean => {
  const closure = node.getFirstAncestor(Node.isFunctionLikeDeclaration);
  return closure !== undefined && Node.isIdentifier(node) &&
    (node.getSymbol()?.getDeclarations() ?? []).some(declaration => declaration.getFirstAncestor(Node.isFunctionLikeDeclaration) !== closure);
};

const allowedInstanceUse = (node: Expression, projection: ScalarProjection, aggregates: readonly ClassDeclaration[]): boolean => {
  const parent = node.getParent();
  if (capturesBinding(node)) return false;
  if (Node.isBinaryExpression(node) && node.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
      (dataTarget(unwrap(node.getLeft())) || transparentReplacement(node, projection, aggregates)) && Node.isExpressionStatement(outermostWrapper(node).getParent())) return true;
  if (Node.isBinaryExpression(parent) && parent.getLeft() === outermostWrapper(node) &&
      parent.getOperatorToken().getKind() === SyntaxKind.EqualsToken && (dataTarget(unwrap(node)) || transparentReplacement(parent, projection, aggregates))) return true;
  if (Node.isIdentifier(node) && Node.isBinaryExpression(parent) && parent.getRight() === node && dataTarget(parent.getLeft()) && isPlainDataPathFromThis(parent.getLeft())) {
    const setter = parent.getFirstAncestorByKind(SyntaxKind.SetAccessor);
    const cls = setter?.getParent();
    const statements = setter?.getBody();
    const parameter = setter === undefined ? undefined : simpleParameter(setter.getParameters());
    if (Node.isClassDeclaration(cls) && aggregates.includes(cls) && Node.isBlock(statements) && statements.getStatements().length === 1 &&
        parameter !== undefined && setter?.getParameters().length === 1 && node.getSymbol() === parameter.getSymbol() &&
        Node.isExpressionStatement(parent.getParent()) && parent.getParent()?.getParent() === statements) return true;
  }
  if (isWritten(outermostWrapper(node))) return false;
  if (Node.isParenthesizedExpression(parent) || Node.isNonNullExpression(parent)) return true;
  if (Node.isAsExpression(parent) || Node.isTypeAssertion(parent)) {
    return true;
  }
  if (Node.isPropertyAccessExpression(parent) && parent.getExpression() === node && !parent.hasQuestionDotToken()) {
    if (isWritten(outermostWrapper(parent))) return false;
    const declarations = parent.getNameNode().getSymbol()?.getDeclarations() ?? [];
    if (declarations.length === 1 && declarations[0] === projection.getter) return true;
    const method = declarations.length === 1 ? declarations[0] : undefined;
    const call = parent.getParent();
    return Node.isMethodDeclaration(method) && Node.isCallExpression(call) && call.getExpression() === parent &&
      !call.hasQuestionDotToken() && proveWrapperPredicate(method, projection).kind === 'proven';
  }
  if (Node.isBinaryExpression(parent) && [SyntaxKind.EqualsEqualsEqualsToken, SyntaxKind.ExclamationEqualsEqualsToken].includes(parent.getOperatorToken().getKind())) return true;
  if ((Node.isIfStatement(parent) && parent.getExpression() === node) ||
      (Node.isPrefixUnaryExpression(parent) && parent.getOperatorToken() === SyntaxKind.ExclamationToken)) return true;
  return plainExposure(node) || isStoredConstruction(node, projection, aggregates);
};

const allowedClassUse = (node: Node, projection: ScalarProjection): boolean => {
  const parent = node.getParent();
  if (Node.isNewExpression(parent) && parent.getExpression() === node) return proveProjectedConstruction(parent, projection).kind === 'proven';
  if (!Node.isPropertyAccessExpression(parent) || parent.getExpression() !== node || parent.hasQuestionDotToken()) return false;
  const call = parent.getParent();
  return Node.isCallExpression(call) && call.getExpression() === parent &&
    proveProjectedConstruction(call, projection).kind === 'proven';
};

const allowedRecordUse = (node: Node, aggregates: readonly ClassDeclaration[]): boolean => {
  if (capturesBinding(node)) return false;
  const parent = node.getParent();
  if (Node.isParenthesizedExpression(parent) || Node.isAsExpression(parent) || Node.isTypeAssertion(parent) || Node.isNonNullExpression(parent)) return true;
  if (Node.isPropertyAccessExpression(parent) && parent.getExpression() === node) return true;
  if (Node.isNewExpression(parent) || Node.isCallExpression(parent)) {
    if (acceptsRecord(parent, aggregates)) return true;
  }
  if (Node.isCallExpression(parent) && parent.getExpression().getKind() === SyntaxKind.SuperKeyword) {
    const constructor = parent.getFirstAncestorByKind(SyntaxKind.Constructor);
    const cls = constructor?.getParent();
    return Node.isClassDeclaration(cls) && aggregates.includes(cls) && storesRecord(cls);
  }
  return false;
};

const changesDispatch = (node: Node, projection: ScalarProjection, ancestry: readonly Node[]): boolean => {
  if (Node.isIdentifier(node) && isWritten(outermostWrapper(node)) && ancestry.some(cls => refersTo(node, cls))) return true;
  if ((Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) && isWritten(outermostWrapper(node))) {
    const receiver = node.getExpression();
    const constructor = [receiver, unwrap(receiver), ...receiver.getDescendants()].filter(candidate => !isNameOrType(candidate)).some(candidate =>
      ((Node.isIdentifier(candidate) || Node.isPropertyAccessExpression(candidate)) && ancestry.some(cls => refersTo(candidate, cls))) ||
      (candidate.getType().getConstructSignatures().length > 0 &&
        (candidate.getType().getSymbol()?.getDeclarations() ?? []).some(declaration => ancestry.includes(declaration)))); 
    const name = Node.isPropertyAccessExpression(node) ? node.getName() : undefined;
    return constructor || (isInstance(receiver, projection) && name !== projection.storage.holder.getName());
  }
  if (Node.isCallExpression(node)) {
    const callee = node.getExpression();
    if (Node.isPropertyAccessExpression(callee) && ['assign', 'defineProperty', 'defineProperties', 'set', 'deleteProperty', 'setPrototypeOf'].includes(callee.getName())) {
      const [target] = node.getArguments();
      return target !== undefined && (isInstance(target, projection) || [target, ...target.getDescendants()].filter(candidate => !isNameOrType(candidate)).some(candidate => ancestry.some(cls => refersTo(candidate, cls))));
    }
  }
  return false;
};

export const observeProjection = (projection: ScalarProjection, sources: SourceIndex, aggregates: readonly ClassDeclaration[] = []): ObservableProjection => {
  const declarations = declarationHazards(projection, sources);
  const reasons: { node: Node; reason: string }[] = [
    ...declarations.hazards.map(hazard => ({ node: hazard.node, reason: hazard.kind })),
    ...declarations.limitations,
    ...dependencyHazards(projection, sources).map(node => ({ node, reason: 'unproved projection dependency use or replacement' })),
  ];
  if (projection.values.some(value => Number.isNaN(value.member.getValue()))) reasons.push({ node: projection.wrapper, reason: 'unproved NaN predicate domain' });
  if (new Set(projection.values.map(value => value.token)).size !== projection.values.length) reasons.push({ node: projection.wrapper, reason: 'ambiguous scalar tokens' });
  const flows = new ProjectionFlows(projection);
  const structuralWrites = new StructuralWrites(projection, sources);
  const records = new ProjectionRecords(projection, aggregates);
  for (const file of sources.files) {
    file.forEachDescendant(node => {
      if (isNameOrType(node)) return;
      if (structuralWrites.observes(node)) reasons.push({ node, reason: 'structural receiver may replace projected dispatch' });
      if (Node.isExpression(node)) {
        const expected = node.getContextualType();
        if (expected !== undefined && flows.mismatches(unwrap(node).getType(), expected, node)) reasons.push({ node, reason: 'unproved runtime projection implementation' });
      }
      if (changesDispatch(node, projection, declarations.ancestry)) reasons.push({ node, reason: 'observable dispatch replacement' });
      if (inAncestry(node, declarations.ancestry)) return;
      if (Node.isCallExpression(node) && structuralWrites.escapes(node)) reasons.push({ node, reason: 'unproved structural wrapper escape' });
      if (Node.isExpression(node) && !isInstance(node, projection) && (records.contains(node.getType(), node) || records.contains(unwrap(node).getType(), node) || records.contains(originalExpressionType(node), node)) && !allowedRecordUse(node, aggregates)) {
        reasons.push({ node, reason: 'unproved wrapper storage record use or escape' });
      }
      if (Node.isExpression(node) && isInstance(node, projection) && !allowedInstanceUse(node, projection, aggregates)) {
        reasons.push({ node, reason: 'unproved wrapper use or escape' });
      }
      if ((Node.isIdentifier(node) || Node.isPropertyAccessExpression(node)) &&
          declarations.ancestry.some(cls => refersTo(node, cls)) && !allowedClassUse(node, projection)) {
        reasons.push({ node, reason: 'unproved class dispatch or replacement' });
      }
    });
  }
  return { kind: 'observed', scope: 'loaded-project-uses', admitted: reasons.length === 0, reasons };
};
