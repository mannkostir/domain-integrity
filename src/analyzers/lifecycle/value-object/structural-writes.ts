import { originalExpressionType } from './original-type';
import { isDefaultLibraryNode } from '../../shared/library';
import { referencedClass, refersTo } from './identity';
import { isLibraryNode } from '../../shared/library';
import { CallExpression, NewExpression, Node, ParameterDeclaration, SyntaxKind, Type, VariableDeclarationKind } from 'ts-morph';
import { SourceIndex } from '../../shared/source-index';
import { isWritten, keyNames } from '../../shared/writes';
import { outermostWrapper, unwrap } from '../../shared/wrappers';
import { ScalarProjection, MAX_PROJECTION_DEPTH } from './model';
import { projectionReceiverType } from './receiver-types';
import { freshClassInstance, freshProjectConstruction } from './fresh-receiver';

type Invocation = CallExpression | NewExpression;
type Path = readonly (string | undefined)[];

export class StructuralWrites {
  private readonly invocations = new Map<Node, Invocation[]>();
  private indexed = false;
  constructor(private readonly projection: ScalarProjection, private readonly sources: SourceIndex) {}
  observes(node: Node): boolean {
    if (Node.isCallExpression(node)) return this.reflects(node);
    if ((!Node.isPropertyAccessExpression(node) && !Node.isElementAccessExpression(node)) || !isWritten(outermostWrapper(node))) return false;
    const names = Node.isPropertyAccessExpression(node) ? [node.getName()] : keyNames(node.getArgumentExpression());
    const members = new Set([this.projection.getter.getName(), this.projection.storage.holder.getName(), ...this.projection.wrapper.getMethods().filter(method => !method.isStatic()).map(method => method.getName())]);
    if (names.length > 0 && !names.some(name => members.has(name))) return false;
    const receiver = node.getExpression();
    if (projectionReceiverType(receiver.getType(), this.projection)) return false;
    if (!this.compatible(receiver.getType()) && !this.compatible(unwrap(receiver).getType())) return false;
    return this.mayAlias(receiver, [], new Set(), 0);
  }
  escapes(call: CallExpression): boolean {
    return call.getArguments().some(argument => {
      const type = originalExpressionType(argument);
      return this.compatible(type) && (this.specificView(type) || this.knownAlias(argument, [], new Set(), 0)) && this.mayAlias(argument, [], new Set(), 0);
    });
  }
  private knownAlias(expression: Node, path: Path, seen: ReadonlySet<Node>, depth: number): boolean {
    if (depth >= MAX_PROJECTION_DEPTH || seen.has(expression)) return false;
    const node = unwrap(expression);
    const selected = this.select(originalExpressionType(node), path, node);
    if (selected?.some(type => projectionReceiverType(type, this.projection))) return true;
    const next = new Set([...seen, expression]);
    if (Node.isPropertyAccessExpression(node)) return this.knownAlias(node.getExpression(), [node.getName(), ...path], next, depth + 1);
    if (!Node.isIdentifier(node)) return false;
    const declarations = node.getSymbol()?.getDeclarations() ?? [];
    const declaration = declarations.length === 1 ? declarations[0] : undefined;
    if (Node.isVariableDeclaration(declaration)) {
      const initializer = declaration.getInitializer();
      return initializer !== undefined && this.knownAlias(initializer, path, next, depth + 1);
    }
    if (!Node.isParameterDeclaration(declaration)) return false;
    const owner = declaration.getParent();
    if (!Node.isFunctionLikeDeclaration(owner)) return false;
    const position = owner.getParameters().indexOf(declaration);
    return this.calls(declaration).some(call => {
      const argument = call.getArguments()[position];
      return argument !== undefined && this.knownAlias(argument, path, next, depth + 1);
    });
  }
  private reflects(call: CallExpression): boolean {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || !['assign', 'defineProperty', 'defineProperties', 'set', 'deleteProperty', 'setPrototypeOf'].includes(callee.getName())) return false;
    const declarations = callee.getNameNode().getSymbol()?.getDeclarations() ?? [];
    if (declarations.length === 0 || !declarations.every(isDefaultLibraryNode)) return false;
    const arguments_ = call.getArguments();
    const targets = [arguments_[0], ...(callee.getName() === 'set' ? [arguments_[3]] : [])];
    return targets.some(target => target !== undefined && this.compatible(target.getType()) && this.mayAlias(target, [], new Set(), 0));
  }
  private compatible(type: Type): boolean {
    return type.isAny() || type.isUnknown() || (type.getConstructSignatures().length === 0 && this.projection.wrapper.getType().isAssignableTo(type));
  }
  private select(type: Type, path: Path, at: Node): readonly Type[] | undefined {
    if (path.length === 0) return [type];
    const alternatives = [...type.getUnionTypes(), ...type.getIntersectionTypes()];
    if (alternatives.length > 0) {
      const results = alternatives.map(member => this.select(member, path, at));
      return results.some(result => result === undefined) ? undefined : results.flatMap(result => result ?? []);
    }
    const [name, ...rest] = path;
    if (name === undefined || type.isAny() || type.isUnknown()) return undefined;
    const member = type.getProperty(name);
    return member === undefined ? undefined : this.select(member.getTypeAtLocation(at), rest, at);
  }
  private specificView(type: Type): boolean {
    if (!this.compatible(type)) return false;
    const at = this.projection.wrapper;
    const value = type.getProperty(this.projection.getter.getName());
    const scalar = value?.getTypeAtLocation(at);
    if (value !== undefined && !value.isOptional() && scalar !== undefined && !scalar.isAny() && !scalar.isUnknown() && scalar.isAssignableTo(this.projection.getter.getReturnType())) return true;
    return this.projection.wrapper.getMethods().some(method => {
      const member = type.getProperty(method.getName());
      const memberType = member?.getTypeAtLocation(at);
      return !method.isStatic() && member !== undefined && !member.isOptional() && memberType !== undefined && !memberType.isAny() && !memberType.isUnknown();
    });
  }
  private unrelatedSibling(type: Type): boolean {
    const declarations = type.getSymbol()?.getDeclarations() ?? [];
    const cls = declarations.length === 1 ? declarations[0] : undefined;
    const base = this.projection.storage.holder.getParent();
    return Node.isClassDeclaration(cls) && cls !== this.projection.wrapper && cls.getBaseTypes().some(parent => parent.getSymbol()?.getDeclarations().includes(base)) &&
      (type.getProperty(this.projection.getter.getName()) === undefined ||
        this.projection.wrapper.getMethods().every(method => method.isStatic() || type.getProperty(method.getName()) === undefined));
  }
  private unboundUse(owner: Node): boolean {
    return this.sources.ofKind(SyntaxKind.Identifier).some(reference => {
      if (!(reference.getSymbol()?.getDeclarations() ?? []).includes(owner) || (Node.hasName(owner) && owner.getNameNode() === reference) ||
          reference.getAncestors().some(ancestor => Node.isTypeNode(ancestor) || Node.isImportDeclaration(ancestor) || Node.isExportDeclaration(ancestor))) return false;
      const parent = reference.getParent();
      return Node.isPropertyAccessExpression(parent) && parent.getExpression() === reference && ['call', 'apply', 'bind'].includes(parent.getName());
    });
  }
  private calls(parameter: ParameterDeclaration): readonly Invocation[] {
    if (!this.indexed) {
      this.indexed = true;
      for (const call of [...this.sources.ofKind(SyntaxKind.CallExpression), ...this.sources.ofKind(SyntaxKind.NewExpression)]) {
        const owner = call.getProject().getTypeChecker().getResolvedSignature(call)?.getDeclaration();
        if (owner !== undefined) this.invocations.set(owner, [...(this.invocations.get(owner) ?? []), call]);
      }
    }
    return this.invocations.get(parameter.getParent()) ?? [];
  }
  private mayAlias(expression: Node, path: Path, seen: ReadonlySet<Node>, depth: number): boolean {
    if (depth >= MAX_PROJECTION_DEPTH || seen.has(expression)) return true;
    const node = unwrap(expression);
    const selected = this.select(node.getType(), path, node);
    if (selected !== undefined && selected.some(type => projectionReceiverType(type, this.projection))) return true;
    if (selected !== undefined && selected.every(type => !this.compatible(type))) return false;
    const next = new Set([...seen, expression]);
    if (Node.isPropertyAccessExpression(node) && node.getName() === 'prototype') {
      const cls = referencedClass(node.getExpression());
      if (cls !== undefined && cls !== this.projection.wrapper && !isLibraryNode(cls) && cls.getDecorators().length === 0 &&
          !this.sources.ofKind(SyntaxKind.Identifier).some(reference => refersTo(reference, cls) && isWritten(outermostWrapper(reference)))) return false;
    }
    if (Node.isPropertyAccessExpression(node)) return this.mayAlias(node.getExpression(), [node.getName(), ...path], next, depth + 1);
    if (Node.isElementAccessExpression(node)) {
      const names = keyNames(node.getArgumentExpression());
      return this.mayAlias(node.getExpression(), [names.length === 1 ? names[0] : undefined, ...path], next, depth + 1);
    }
    if (Node.isIdentifier(node)) {
      const declarations = node.getSymbol()?.getDeclarations() ?? [];
      const declaration = declarations.length === 1 ? declarations[0] : undefined;
      if (Node.isParameterDeclaration(declaration)) {
        const calls = this.calls(declaration);
        if (calls.length === 0) return this.unboundUse(declaration.getParent()) ||
          (!this.unrelatedSibling(declaration.getType()) && (selected === undefined || selected.some(type => this.specificView(type))));
        const owner = declaration.getParent();
        if (!Node.isFunctionLikeDeclaration(owner)) return true;
        const position = owner.getParameters().indexOf(declaration);
        return calls.some(call => {
          const argument = call.getArguments()[position];
          return argument === undefined || this.mayAlias(argument, path, next, depth + 1);
        });
      }
      if (Node.isVariableDeclaration(declaration)) {
        if (declaration.getFirstAncestorByKind(SyntaxKind.VariableDeclarationList)?.getDeclarationKind() !== VariableDeclarationKind.Const) return true;
        const initializer = declaration.getInitializer();
        if (initializer === undefined || this.replacedCarrier(declaration, path)) return true;
        return this.mayAlias(initializer, path, next, depth + 1);
      }
      return true;
    }
    if (Node.isObjectLiteralExpression(node)) {
      if (path.length === 0) return false;
      const [name, ...rest] = path;
      if (name === undefined || node.getProperties().some(Node.isSpreadAssignment)) return true;
      const property = node.getProperty(name);
      return !Node.isPropertyAssignment(property) || this.mayAlias(property.getInitializerOrThrow(), rest, next, depth + 1);
    }
    if (Node.isNewExpression(node) && path.length === 0) return !freshProjectConstruction(node, this.sources);
    if (Node.isThisExpression(node) && path.length === 0) {
      const binder = node.getFirstAncestor(ancestor => Node.isMethodDeclaration(ancestor) || Node.isGetAccessorDeclaration(ancestor) ||
        Node.isSetAccessorDeclaration(ancestor) || Node.isConstructorDeclaration(ancestor) || Node.isFunctionDeclaration(ancestor) || Node.isFunctionExpression(ancestor));
      const cls = binder?.getParent();
      if (Node.isClassDeclaration(cls) && binder !== undefined && Node.isFunctionLikeDeclaration(binder) &&
          !binder.getParameters().some(parameter => parameter.getName() === 'this') &&
          !projectionReceiverType(cls.getType(), this.projection) && freshClassInstance(cls, this.sources)) return false;
    }
    return true;
  }
  private replacedCarrier(declaration: Node, path: Path): boolean {
    if (path.length === 0) return false;
    return this.sources.ofKind(SyntaxKind.Identifier).some(reference => {
      if (!(reference.getSymbol()?.getDeclarations() ?? []).includes(declaration) || reference === declaration.getFirstChild()) return false;
      const access = reference.getParent();
      if (!Node.isPropertyAccessExpression(access) && !Node.isElementAccessExpression(access)) return false;
      return isWritten(outermostWrapper(access));
    });
  }
}
