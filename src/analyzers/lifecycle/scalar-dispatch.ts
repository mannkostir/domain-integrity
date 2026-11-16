import { ClassDeclaration, Node, SyntaxKind, Type, ts } from 'ts-morph';
import { isDefaultLibraryNode, isLibraryNode } from '../shared/library';
import { SourceIndex } from '../shared/source-index';
import { isWritten, keyNames } from '../shared/writes';
import { outermostWrapper, unwrap } from '../shared/wrappers';
import { MAX_GETTER_DEPTH, hasAmbiguousInstanceShape } from './field-ref';
import { namedClassChain } from './named-chain';
import { defaultLibraryOperations, isRuntimeReference, moduleMayExpose } from './runtime-dependencies';
import { Subclasses } from './subclasses';
import { originalExpressionType } from './value-object/original-type';
import { resolvedSymbol } from './value-object/identity';

type Capability = 'present' | 'absent' | 'unproved';
type CapabilityTraversal = { remaining: number };
type CapabilityDepth = { readonly returns: number; readonly members: number; readonly types: number };

export class ScalarDispatchFacts {
  private readonly dispatch = new Map<ClassDeclaration, boolean>();
  constructor(private readonly sources: SourceIndex, private readonly subclasses: Subclasses) {}
  private escapesClass(reference: Node, chain: readonly ClassDeclaration[]): boolean {
    if (!isRuntimeReference(reference)) return false;
    if (Node.isIdentifier(reference) && ['eval', 'Function'].includes(reference.getText()) &&
      (reference.getSymbol()?.getDeclarations() ?? []).every(isDefaultLibraryNode)) return true;
    const declarations = resolvedSymbol(reference)?.getDeclarations() ?? [];
    if (declarations.some(declaration => Node.isSourceFile(declaration) || Node.isModuleDeclaration(declaration)) && moduleMayExpose(resolvedSymbol(reference), chain)) {
      const access = reference.getParent();
      return !Node.isPropertyAccessExpression(access) || access.getExpression() !== reference || access.hasQuestionDotToken() ||
        access.getNameNode().getSymbol() === undefined || isWritten(outermostWrapper(access));
    }
    if (!declarations.some(declaration => Node.isClassDeclaration(declaration) && chain.includes(declaration))) return false;
    const parent = reference.getParent();
    if (Node.isClassDeclaration(parent) || Node.isImportSpecifier(parent) || Node.isImportClause(parent) || Node.isExportSpecifier(parent) ||
      Node.isExpressionWithTypeArguments(parent) || reference.getAncestors().some(Node.isTypeNode)) return false;
    if (Node.isNewExpression(parent) && parent.getExpression() === reference) return this.constructionEscapes(parent, chain);
    if (Node.isPropertyAccessExpression(parent) && parent.getExpression() === reference && !parent.hasQuestionDotToken()) {
      const call = parent.getParent();
      return !Node.isCallExpression(call) || call.getExpression() !== parent;
    }
    return true;
  }

  private constructionEscapes(construction: Node, chain: readonly ClassDeclaration[]): boolean {
    let wrapped = construction;
    while (wrapped.getParent() !== undefined && unwrap(wrapped.getParentOrThrow()) === unwrap(wrapped)) {
      const wrapper = wrapped.getParentOrThrow();
      if (!Node.isParenthesizedExpression(wrapper) && !Node.isNonNullExpression(wrapper) &&
        !this.preservesIdentity(wrapper.getType(), chain, new Set(), 0)) return true;
      wrapped = wrapper;
    }
    const target = wrapped;
    const parent = target.getParent();
    if (Node.isVariableDeclaration(parent) && parent.getInitializer() === target) return !this.preservesIdentity(parent.getType(), chain, new Set(), 0);
    if (Node.isReturnStatement(parent) && parent.getExpression() === target) {
      const owner = parent.getFirstAncestor(Node.isFunctionLikeDeclaration);
      const type = owner !== undefined && (Node.isFunctionDeclaration(owner) || Node.isMethodDeclaration(owner) || Node.isArrowFunction(owner) ||
        Node.isFunctionExpression(owner) || Node.isGetAccessorDeclaration(owner)) ? owner.getReturnType() : undefined;
      return type === undefined || !this.preservesIdentity(type, chain, new Set(), 0);
    }
    if (Node.isArrowFunction(parent) && parent.getBody() === target) return !this.preservesIdentity(parent.getReturnType(), chain, new Set(), 0);
    if (Node.isExpressionStatement(parent) ||
      ((Node.isCallExpression(parent) || Node.isNewExpression(parent)) && parent.getArguments().includes(target))) return false;
    if ((Node.isPropertyAccessExpression(parent) || Node.isElementAccessExpression(parent)) && parent.getExpression() === target) {
      const member = outermostWrapper(parent);
      const use = member.getParent();
      return parent.getType().getCallSignatures().length > 0 && (!Node.isCallExpression(use) || use.getExpression() !== member);
    }
    return true;
  }

  private instanceEscapes(reference: Node, chain: readonly ClassDeclaration[]): boolean {
    if (!Node.isExpression(reference) || !isRuntimeReference(reference)) return false;
    if ((resolvedSymbol(reference)?.getDeclarations() ?? []).some(Node.isClassDeclaration)) return false;
    const type = reference.getType();
    if (![type, originalExpressionType(reference)].some(candidate => this.instanceType(candidate, chain, new Set(), 0))) return false;
    const parent = reference.getParent();
    if ((Node.isParameterDeclaration(parent) || Node.isVariableDeclaration(parent)) && parent.getNameNode() === reference) return false;
    return this.constructionEscapes(reference, chain);
  }

  private instanceType(type: Type, chain: readonly ClassDeclaration[], visited: ReadonlySet<Type>, depth: number): boolean {
    if (depth >= MAX_GETTER_DEPTH || visited.has(type)) return true;
    if (type.getConstructSignatures().length > 0) return false;
    if ((type.getSymbol()?.getDeclarations() ?? []).some(declaration => Node.isClassDeclaration(declaration) && chain.includes(declaration))) return true;
    const next = new Set([...visited, type]);
    if ([...type.getUnionTypes(), ...type.getIntersectionTypes()].some(member => this.instanceType(member, chain, next, depth + 1))) return true;
    const constraint = type.isTypeParameter() ? type.getConstraint() : undefined;
    return constraint !== undefined && this.instanceType(constraint, chain, next, depth + 1);
  }

  private receiverCapability(type: Type, chain: readonly ClassDeclaration[], at: Node, work: CapabilityTraversal, depth: CapabilityDepth = { returns: 0, members: 0, types: 0 }, returning = false, active: ReadonlyMap<Type, boolean> = new Map()): Capability {
    if (work.remaining-- <= 0) return 'unproved';
    const declarations = type.getSymbol()?.getDeclarations() ?? [];
    if (declarations.some(declaration => Node.isClassDeclaration(declaration) && chain.includes(declaration))) return returning ? 'present' : 'absent';
    if (type.isAny() || type.isUnknown()) return 'absent';
    if (!type.isObject() && !type.isUnionOrIntersection() && !type.isTypeParameter()) return 'absent';
    if (active.get(type) === returning) return 'absent';
    if (Object.values(depth).some(value => value >= MAX_GETTER_DEPTH)) return 'unproved';
    const next = new Map([...active, [type, returning]]);
    let result: Capability = 'absent';
    const visit = (candidate: Type, edge: keyof CapabilityDepth, throughReturn = returning): boolean => {
      const found = this.receiverCapability(candidate, chain, at, work, { ...depth, types: edge === 'types' ? depth.types + 1 : 0, [edge]: depth[edge] + 1 }, throughReturn, next);
      if (found === 'present') result = 'present';
      else if ((found === 'unproved' || work.remaining <= 0) && result === 'absent') result = 'unproved';
      return found === 'present' || work.remaining <= 0;
    };
    if ([...type.getUnionTypes(), ...type.getIntersectionTypes()].some(member => visit(member, 'types'))) return result;
    const constraint = type.isTypeParameter() ? type.getConstraint() : undefined;
    if (constraint !== undefined && visit(constraint, 'types')) return result;
    if (type.getCallSignatures().some(signature => visit(signature.getReturnType(), 'returns', true))) return result;
    const element = type.getArrayElementType();
    if (element !== undefined) { visit(element, 'types'); return result; }
    if (type.isTuple()) { type.getTupleElements().some(member => visit(member, 'types')); return result; }
    if (!type.isObject()) return result;
    if (declarations.some(isDefaultLibraryNode) && !declarations.some(Node.isMappedTypeNode)) {
      type.getTypeArguments().some(argument => visit(argument, 'types'));
      return result;
    }
    for (const member of type.getProperties()) {
      if (visit(member.getTypeAtLocation(at), 'members')) return result;
      if (work.remaining <= 0) return 'unproved';
    }
    for (const index of [type.getStringIndexType(), type.getNumberIndexType()]) {
      if (index !== undefined && visit(index, 'members')) return result;
    }
    return result;
  }

  private preservesCallableCapability(type: Type, chain: readonly ClassDeclaration[], at: Node): boolean {
    if (this.receiverCapability(type, chain, at, { remaining: 256 }) !== 'present') return false;
    let remaining = 256;
    const visit = (candidate: Type, active: ReadonlySet<Type>, depth: number, returning: boolean): boolean => {
      if (remaining-- <= 0 || depth >= MAX_GETTER_DEPTH || active.has(candidate)) return false;
      if (candidate.isAny() || candidate.isUnknown() || (candidate.getConstructSignatures().length > 0 && candidate.getCallSignatures().length === 0)) return false;
      if (returning && (candidate.isNull() || candidate.isUndefined())) return true;
      if ((candidate.getSymbol()?.getDeclarations() ?? []).some(declaration => Node.isClassDeclaration(declaration) && chain.includes(declaration))) return returning;
      const next = new Set([...active, candidate]);
      if (candidate.isUnion()) return candidate.getUnionTypes().every(member => visit(member, next, depth + 1, returning));
      const signatures = candidate.getCallSignatures();
      if (signatures.length > 0) return signatures.every(signature => visit(signature.getReturnType(), next, depth + 1, true));
      if (candidate.isIntersection()) {
        for (const member of candidate.getIntersectionTypes()) {
          if (remaining <= 0) return false;
          if (visit(member, next, depth + 1, returning)) return true;
        }
        return false;
      }
      const constraint = candidate.isTypeParameter() ? candidate.getConstraint() : undefined;
      if (constraint !== undefined) return visit(constraint, next, depth + 1, returning);
      return false;
    };
    return visit(type, new Set(), 0, false);
  }

  private primitiveRepresentation(type: Type, work: CapabilityTraversal = { remaining: 256 }, active: ReadonlySet<Type> = new Set(), depth = 0): boolean {
    if (work.remaining-- <= 0 || depth >= MAX_GETTER_DEPTH || active.has(type)) return false;
    if ((type.getFlags() & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike |
      ts.TypeFlags.BigIntLike | ts.TypeFlags.ESSymbolLike | ts.TypeFlags.Null | ts.TypeFlags.Undefined)) !== 0) return true;
    const next = new Set([...active, type]);
    if (type.isUnion()) return type.getUnionTypes().every(member => this.primitiveRepresentation(member, work, next, depth + 1));
    const constraint = type.isTypeParameter() ? type.getConstraint() : undefined;
    return constraint !== undefined && this.primitiveRepresentation(constraint, work, next, depth + 1);
  }

  private invocationPreservesCapability(call: import('ts-morph').CallExpression | import('ts-morph').NewExpression, chain: readonly ClassDeclaration[]): boolean {
    if (call.getProject().getTypeChecker().getResolvedSignature(call) === undefined) return false;
    const result = call.getType();
    const work = { remaining: 256 };
    const preserves = (type: Type, active: ReadonlySet<Type>, depth: number): boolean => {
      if (work.remaining-- <= 0 || depth >= MAX_GETTER_DEPTH || active.has(type)) return false;
      if (this.primitiveRepresentation(type, work)) return true;
      if (this.preservesIdentity(type, chain, new Set(), 0, work)) return true;
      if (type.isAny() || type.isUnknown() || type.getConstructSignatures().length > 0) return false;
      const next = new Set([...active, type]);
      if (type.isUnion()) return type.getUnionTypes().every(member => preserves(member, next, depth + 1));
      const constraint = type.isTypeParameter() ? type.getConstraint() : undefined;
      if (constraint !== undefined) return preserves(constraint, next, depth + 1);
      const signatures = type.getCallSignatures();
      if (!signatures.every(signature => preserves(signature.getReturnType(), next, depth + 1))) return false;
      const element = type.getArrayElementType();
      if (element !== undefined) return preserves(element, next, depth + 1);
      if (type.isTuple()) return type.getTupleElements().every(member => preserves(member, next, depth + 1));
      if (!type.isObject() || (type.getSymbol()?.getDeclarations() ?? []).some(isDefaultLibraryNode)) return false;
      if (signatures.length === 0 && this.receiverCapability(type, chain, call, work, undefined, true) !== 'present') return false;
      const members = type.getProperties();
      const indices = [type.getStringIndexType(), type.getNumberIndexType()].filter((index): index is Type => index !== undefined);
      return signatures.length + members.length + indices.length > 0 && members.every(member => preserves(member.getTypeAtLocation(call), next, depth + 1)) &&
        indices.every(index => preserves(index, next, depth + 1));
    };
    if (this.primitiveRepresentation(result, work) || this.preservesIdentity(result, chain, new Set(), 0, work)) return true;
    if (this.receiverCapability(result, chain, call, { remaining: 256 }, undefined, true) !== 'present') return false;
    return preserves(result, new Set(), 0);
  }

  private callableEscapes(reference: Node, chain: readonly ClassDeclaration[]): boolean {
    if (!Node.isExpression(reference) || !isRuntimeReference(reference)) return false;
    const work = { remaining: 256 };
    if ([...new Set([reference.getType(), unwrap(reference).getType(), originalExpressionType(reference)])].every(type =>
      this.receiverCapability(type, chain, reference, work) === 'absent')) return false;
    let target: Node = reference;
    while (target.getParent() !== undefined && unwrap(target.getParentOrThrow()) === unwrap(target)) {
      const wrapper = target.getParentOrThrow();
      if (!Node.isParenthesizedExpression(wrapper) && !Node.isNonNullExpression(wrapper) &&
        !this.preservesCallableCapability(wrapper.getType(), chain, wrapper)) return true;
      target = wrapper;
    }
    const parent = target.getParent();
    if (Node.isCallExpression(parent) && parent.getExpression() === target && !parent.hasQuestionDotToken()) return !this.invocationPreservesCapability(parent, chain);
    if (Node.isNewExpression(parent) && parent.getExpression() === target) {
      const work = { remaining: 256 };
      const relevant = target.getType().getCallSignatures().some(signature =>
        this.receiverCapability(signature.getReturnType(), chain, target, work, undefined, true) !== 'absent');
      return relevant && !this.invocationPreservesCapability(parent, chain);
    }
    if (Node.isPropertyAccessExpression(parent) && parent.getExpression() === target && !parent.hasQuestionDotToken() &&
      parent.getNameNode().getSymbol() !== undefined && !isWritten(outermostWrapper(parent))) return false;
    if (Node.isVariableDeclaration(parent) && parent.getInitializer() === target) {
      if (target.getType().getConstructSignatures().length > 0 && parent.getType() === target.getType() &&
        (target.getType().getCallSignatures().length === 0 || this.preservesCallableCapability(target.getType(), chain, parent))) return false;
      return !this.preservesCallableCapability(parent.getType(), chain, parent);
    }
    if (Node.isReturnStatement(parent) && parent.getExpression() === target) {
      const owner = parent.getFirstAncestor(Node.isFunctionLikeDeclaration);
      const type = owner !== undefined && (Node.isFunctionDeclaration(owner) || Node.isMethodDeclaration(owner) || Node.isArrowFunction(owner) ||
        Node.isFunctionExpression(owner) || Node.isGetAccessorDeclaration(owner)) ? owner.getReturnType() : undefined;
      return type === undefined || !this.preservesCallableCapability(type, chain, parent);
    }
    if (Node.isArrowFunction(parent) && parent.getBody() === target) return !this.preservesCallableCapability(parent.getReturnType(), chain, parent);
    return true;
  }

  private preservesIdentity(type: Type, chain: readonly ClassDeclaration[], visited: ReadonlySet<Type>, depth: number, work: CapabilityTraversal = { remaining: 256 }): boolean {
    if (work.remaining-- <= 0 || depth >= MAX_GETTER_DEPTH || visited.has(type)) return false;
    if (type.isNull() || type.isUndefined()) return true;
    if (type.isAny() || type.isUnknown() || type.getConstructSignatures().length > 0) return false;
    const next = new Set([...visited, type]);
    if (type.isUnion()) return type.getUnionTypes().every(member => this.preservesIdentity(member, chain, next, depth + 1, work));
    if ((type.getSymbol()?.getDeclarations() ?? []).some(declaration => Node.isClassDeclaration(declaration) && chain.includes(declaration))) return true;
    if (type.isIntersection()) {
      for (const member of type.getIntersectionTypes()) {
        if (work.remaining <= 0) return false;
        if (this.preservesIdentity(member, chain, next, depth + 1, work)) return true;
      }
      return false;
    }
    const constraint = type.isTypeParameter() ? type.getConstraint() : undefined;
    return constraint !== undefined && this.preservesIdentity(constraint, chain, next, depth + 1, work);
  }

  private unrelatedPrototype(node: Node, chain: readonly ClassDeclaration[]): boolean {
    const target = unwrap(node);
    if (!Node.isPropertyAccessExpression(target) || target.getName() !== 'prototype') return false;
    const declarations = resolvedSymbol(target.getExpression())?.getDeclarations() ?? [];
    const other = declarations.length === 1 && Node.isClassDeclaration(declarations[0]) ? namedClassChain(declarations[0]) : undefined;
    return other !== undefined && other.every(candidate => !chain.includes(candidate) && !isLibraryNode(candidate) &&
      !hasAmbiguousInstanceShape(candidate) && candidate.getDescendantsOfKind(SyntaxKind.Decorator).length === 0);
  }

  stable(cls: ClassDeclaration): boolean {
    const cached = this.dispatch.get(cls);
    if (cached !== undefined) return cached;
    const chain = namedClassChain(cls);
    const dependencies = chain === undefined ? [] : [...new Set(chain.flatMap(candidate => [candidate, ...this.subclasses.of(candidate)]))];
    const stable = chain !== undefined && !chain.some(candidate => isLibraryNode(candidate) || hasAmbiguousInstanceShape(candidate) || candidate.getDescendantsOfKind(SyntaxKind.Decorator).length > 0) && this.subclasses.of(cls).length === 0 &&
      !dependencies.some(candidate => candidate.getDescendantsOfKind(SyntaxKind.Decorator).length > 0) &&
      !chain.some(candidate => candidate.getConstructors().some(constructor =>
        constructor.getDescendantsOfKind(SyntaxKind.ReturnStatement).some(statement => statement.getExpression() !== undefined))) &&
      !['prototype', '__proto__'].some(name => this.sources.propertyAccessesNamed(name).some(access => isWritten(outermostWrapper(access)))) &&
      !this.sources.ofKind(SyntaxKind.ElementAccessExpression).some(access =>
        isWritten(outermostWrapper(access)) && (keyNames(access.getArgumentExpression()).length === 0 || keyNames(access.getArgumentExpression()).some(name => ['prototype', '__proto__', 'eval', 'Function'].includes(name)))) &&
      !this.sources.propertyAccessesNamed('constructor').some(access => !access.getAncestors().some(Node.isTypeNode)) &&
      !this.sources.ofKind(SyntaxKind.ElementAccessExpression).some(access => keyNames(access.getArgumentExpression()).includes('constructor')) &&
      ![...this.sources.ofKind(SyntaxKind.Identifier), ...this.sources.ofKind(SyntaxKind.PropertyAccessExpression), ...this.sources.ofKind(SyntaxKind.ElementAccessExpression)].some(reference => this.escapesClass(reference, dependencies)) &&
      !this.sources.files.some(file => file.getDescendants().some(expression => this.instanceEscapes(expression, dependencies))) &&
      !this.sources.files.some(file => file.getDescendants().some(expression => this.callableEscapes(expression, dependencies))) &&
      ![...this.sources.ofKind(SyntaxKind.CallExpression), ...this.sources.ofKind(SyntaxKind.NewExpression)].some(call => {
        const operations = defaultLibraryOperations(call);
        if (operations.some(operation => ['assign', 'defineProperty', 'defineProperties', 'set', 'deleteProperty', 'setPrototypeOf'].includes(operation.name))) return true;
        return call.getArguments().some(argument => {
          if (this.unrelatedPrototype(argument, dependencies)) return false;
          const type = argument.getType();
          return cls.getType().isAssignableTo(type) ||
            (type.getSymbol()?.getDeclarations() ?? []).some(declaration => Node.isClassDeclaration(declaration) && dependencies.includes(declaration));
        });
      });
    this.dispatch.set(cls, stable);
    return stable;
  }
}
