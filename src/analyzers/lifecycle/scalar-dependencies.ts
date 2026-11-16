import { Node, Symbol as MorphSymbol, SyntaxKind, Type, ts } from 'ts-morph';
import { isDefaultLibraryNode } from '../shared/library';
import { SourceIndex } from '../shared/source-index';
import { isWritten, keyNames } from '../shared/writes';
import { outermostWrapper, unwrap } from '../shared/wrappers';
import { defaultLibraryOperation, defaultLibraryOperations, isRuntimeReference, moduleMayExpose } from './runtime-dependencies';
import { isDeclarationReference, resolvedSymbol } from './value-object/identity';

export class ScalarDependencyFacts {
  private readonly enums = new Map<Node, boolean>();
  private includes: boolean | undefined;
  constructor(private readonly sources: SourceIndex) {}
  enumMember(node: Node): boolean {
    if (!enumLiteral(node) || !Node.isPropertyAccessExpression(node)) return false;
    const member = resolvedSymbol(node.getNameNode())?.getDeclarations()[0];
    if (!Node.isEnumMember(member)) return false;
    const enumeration = member.getParent();
    const cached = this.enums.get(enumeration);
    if (cached !== undefined) return cached;
    const safe = [...this.sources.ofKind(SyntaxKind.Identifier), ...this.sources.ofKind(SyntaxKind.PropertyAccessExpression)].every(reference => {
      if (!isRuntimeReference(reference)) return true;
      const declarations = resolvedSymbol(reference)?.getDeclarations() ?? [];
      if (declarations.some(declaration => Node.isSourceFile(declaration) || Node.isModuleDeclaration(declaration)) && moduleMayExpose(resolvedSymbol(reference), [enumeration])) {
        const access = reference.getParent();
        return Node.isPropertyAccessExpression(access) && access.getExpression() === reference && !access.hasQuestionDotToken() &&
          access.getNameNode().getSymbol() !== undefined && !isWritten(outermostWrapper(access));
      }
      if (!(resolvedSymbol(reference)?.getDeclarations() ?? []).includes(enumeration)) return true;
      const parent = reference.getParent();
      if (Node.isEnumDeclaration(parent) || Node.isImportSpecifier(parent) || Node.isExportSpecifier(parent) ||
        reference.getAncestors().some(Node.isTypeNode)) return true;
      if (!Node.isPropertyAccessExpression(parent) || parent.getExpression() !== reference || parent.hasQuestionDotToken() ||
        isWritten(outermostWrapper(parent))) return false;
      return (resolvedSymbol(parent.getNameNode())?.getDeclarations() ?? []).every(declaration =>
        Node.isEnumMember(declaration) && declaration.getParent() === enumeration);
    });
    this.enums.set(enumeration, safe);
    return safe;
  }


  includesStable(): boolean {
    this.includes ??= !this.sources.files.some(file => file.getDescendants().some(node => this.arrayExposure(node))) &&
      !this.sources.propertyAccessesNamed('includes').some(access => isWritten(outermostWrapper(access))) &&
      !this.sources.ofKind(SyntaxKind.ElementAccessExpression).some(access =>
        isWritten(outermostWrapper(access)) && keyNames(access.getArgumentExpression()).includes('includes'));
    return this.includes;
  }

  private arrayConstructor(node: Node): boolean {
    const declarations = resolvedSymbol(node)?.getDeclarations() ?? [];
    const types = node.getType().getSymbol()?.getDeclarations() ?? [];
    return declarations.some(declaration => isDefaultLibraryNode(declaration) && Node.isVariableDeclaration(declaration) && declaration.getName() === 'Array') ||
      types.some(declaration => isDefaultLibraryNode(declaration) && Node.isInterfaceDeclaration(declaration) && declaration.getName() === 'ArrayConstructor');
  }

  private mayBeArray(type: Type, visited: ReadonlySet<Type> = new Set(), depth = 0): boolean {
    if (depth >= 5 || visited.has(type)) return true;
    const next = new Set([...visited, type]);
    if (type.isUnion()) return type.getUnionTypes().some(member => this.mayBeArray(member, next, depth + 1));
    return !(type.isString() || type.isStringLiteral() || type.isNumber() || type.isNumberLiteral() || type.isBoolean() ||
      type.isBooleanLiteral() || type.isBigInt() || type.isBigIntLiteral() || (type.getFlags() & ts.TypeFlags.ESSymbolLike) !== 0 || type.isNull() || type.isUndefined());
  }

  private prototypeOperations(node: Node) {
    return [...(resolvedSymbol(node)?.getDeclarations() ?? []), ...node.getType().getCallSignatures().map(signature => signature.getDeclaration())]
      .flatMap(declaration => {
        const operation = defaultLibraryOperation(declaration);
        return operation?.name === 'getPrototypeOf' ? [operation] : [];
      });
  }

  private preservesPrototypeOperation(node: Node): boolean {
    const signatures = node.getType().getCallSignatures();
    return signatures.length > 0 && signatures.every(signature => defaultLibraryOperation(signature.getDeclaration())?.name === 'getPrototypeOf');
  }

  private prototypeNamespace(node: Node): boolean {
    return (node.getType().getSymbol()?.getDeclarations() ?? []).some(declaration =>
      isDefaultLibraryNode(declaration) && ((Node.isVariableDeclaration(declaration) && declaration.getName() === 'Object') ||
        (Node.isInterfaceDeclaration(declaration) && declaration.getName() === 'ObjectConstructor') ||
        (Node.isModuleDeclaration(declaration) && declaration.getName() === 'Reflect')));
  }

  private modulePrototypeCapability(node: Node): boolean {
    const isModule = (symbol: MorphSymbol | undefined): symbol is MorphSymbol =>
      symbol !== undefined && symbol.getDeclarations().some(declaration => Node.isSourceFile(declaration) || Node.isModuleDeclaration(declaration));
    const roots = [...new Set([resolvedSymbol(node), node.getType().getSymbol()].filter(isModule))];
    let remaining = 256;
    const runtimeExport = (exported: MorphSymbol, owner: MorphSymbol, active: ReadonlySet<MorphSymbol>, depth: number): boolean => {
      if (remaining-- <= 0 || depth >= 5) return true;
      if (active.has(owner)) return false;
      const declarations = exported.getDeclarations();
      if (declarations.length === 0) return true;
      const runtimeDeclarations = declarations.filter(declaration => !(Node.isExportSpecifier(declaration) && declaration.isTypeOnly()) &&
        declaration.getFirstAncestorByKind(SyntaxKind.ExportDeclaration)?.isTypeOnly() !== true);
      const files = owner.getDeclarations().map(declaration => declaration.getSourceFile());
      if (runtimeDeclarations.some(declaration => files.includes(declaration.getSourceFile()))) return true;
      const next = new Set([...active, owner]);
      return owner.getDeclarations().filter(Node.isSourceFile).some(file => file.getExportDeclarations().some(declaration => {
        if (declaration.isTypeOnly() || declaration.getNamedExports().length > 0 || declaration.getNamespaceExport() !== undefined) return false;
        const target = declaration.getModuleSpecifierSourceFile()?.getSymbol();
        if (target === undefined) return true;
        const member = node.getProject().getTypeChecker().getExportsOfModule(target).find(candidate => candidate.getName() === exported.getName());
        return member !== undefined && (member.getAliasedSymbol() ?? member) === (exported.getAliasedSymbol() ?? exported) &&
          runtimeExport(member, target, next, depth + 1);
      }));
    };
    const visit = (symbol: MorphSymbol, active: ReadonlySet<MorphSymbol>, depth: number): boolean => {
      if (remaining-- <= 0) return true;
      const resolved = symbol.getAliasedSymbol() ?? symbol;
      if (active.has(resolved)) return false;
      const declarations = resolved.getDeclarations();
      if (declarations.length === 0) return true;
      const value = resolved.getValueDeclaration();
      if (value !== undefined && !Node.isSourceFile(value) && (this.prototypeNamespace(value) || this.prototypeOperations(value).length > 0)) return true;
      if (declarations.some(isDefaultLibraryNode)) return false;
      if (!isModule(resolved) && value === undefined) return false;
      if (depth >= 5) return true;
      const next = new Set([...active, resolved]);
      if (isModule(resolved)) return node.getProject().getTypeChecker().getExportsOfModule(resolved).some(exported =>
        runtimeExport(exported, resolved, new Set(), 0) && visit(exported, next, depth + 1));
      const container = value === undefined || Node.isSourceFile(value) ? undefined : value.getType().getSymbol();
      return isModule(container) && visit(container, next, depth + 1);
    };
    return roots.some(symbol => visit(symbol, new Set(), 0));
  }

  private prototypeOperationExposure(node: Node): boolean {
    if (!Node.isExpression(node)) return false;
    const binding = node.getParent();
    if (Node.isBindingElement(binding) && binding.getPropertyNameNode() === node) return false;
    const namespace = this.prototypeNamespace(node);
    const module = !namespace && this.modulePrototypeCapability(node);
    const container = namespace || module;
    if (!container && (node.getType().getCallSignatures().length === 0 || this.prototypeOperations(node).length === 0)) return false;
    let target: Node = node;
    while (target.getParent() !== undefined && unwrap(target.getParentOrThrow()) === unwrap(target)) {
      const wrapper = target.getParentOrThrow();
      if (!Node.isParenthesizedExpression(wrapper) && !Node.isNonNullExpression(wrapper) &&
        !(module ? wrapper.getType() === target.getType() : namespace ? this.prototypeNamespace(wrapper) : this.preservesPrototypeOperation(wrapper))) return true;
      target = wrapper;
    }
    const parent = target.getParent();
    if (Node.isCallExpression(parent) && parent.getExpression() === target && !parent.hasQuestionDotToken()) return false;
    if (namespace && Node.isNewExpression(parent) && parent.getExpression() === target) return false;
    if (container && Node.isPropertyAccessExpression(parent) && parent.getExpression() === target && !parent.hasQuestionDotToken() &&
      parent.getNameNode().getSymbol() !== undefined && !isWritten(outermostWrapper(parent))) return false;
    if (container && Node.isElementAccessExpression(parent) && parent.getExpression() === target && !parent.hasQuestionDotToken() &&
      keyNames(parent.getArgumentExpression()).length === 1 && target.getType().getProperty(keyNames(parent.getArgumentExpression())[0]!) !== undefined &&
      !isWritten(outermostWrapper(parent))) return false;
    if (Node.isVariableDeclaration(parent) && parent.getInitializer() === target) {
      const binding = parent.getNameNode();
      if (module) return (Node.isObjectBindingPattern(binding) && (binding.getElements().length > 256 || binding.getElements().some(element =>
        element.getDotDotDotToken() !== undefined || element.getInitializer() !== undefined))) || parent.getType() !== target.getType();
      if (namespace && Node.isObjectBindingPattern(binding)) {
        const elements = binding.getElements();
        return elements.length > 256 || elements.some(element => {
          if (element.getDotDotDotToken() !== undefined || element.getInitializer() !== undefined) return true;
          const property = element.getPropertyNameNode() ?? element.getNameNode();
          if (!Node.isIdentifier(property) && !Node.isStringLiteral(property)) return true;
          const name = Node.isIdentifier(property) ? property.getText() : property.getLiteralText();
          return name === 'getPrototypeOf' && !this.preservesPrototypeOperation(element.getNameNode());
        });
      }
      return !(namespace ? this.prototypeNamespace(binding) : this.preservesPrototypeOperation(binding));
    }
    return true;
  }

  private arrayExposure(node: Node): boolean {
    if (!isRuntimeReference(node) && !Node.isExportAssignment(node.getParent())) return false;
    if (this.prototypeOperationExposure(node)) return true;
    if (Node.isCallExpression(node)) {
      const operations = defaultLibraryOperations(node);
      const input = node.getArguments()[0];
      if (operations.some(operation => operation.name === 'getPrototypeOf') && (input === undefined || this.mayBeArray(unwrap(input).getType()))) return true;
    }
    if ((Node.isPropertyAccessExpression(node) && node.getName() === '__proto__') ||
      (Node.isElementAccessExpression(node) && keyNames(node.getArgumentExpression()).includes('__proto__'))) return this.mayBeArray(unwrap(node.getExpression()).getType());
    if ((!Node.isIdentifier(node) && !Node.isPropertyAccessExpression(node) && !Node.isElementAccessExpression(node)) || !this.arrayConstructor(node)) return false;
    const target = outermostWrapper(node);
    const parent = target.getParent();
    if (Node.isPropertyAccessExpression(parent) && parent.getExpression() === target) return parent.getName() === 'prototype' || isWritten(outermostWrapper(parent));
    return true;
  }
}

const enumLiteral = (node: Node): boolean => {
  if (!Node.isPropertyAccessExpression(node) || node.hasQuestionDotToken() || !isDeclarationReference(node.getExpression())) return false;
  const declarations = resolvedSymbol(node.getNameNode())?.getDeclarations() ?? [];
  const member = declarations.length === 1 ? declarations[0] : undefined;
  return Node.isEnumMember(member) && member.getValue() !== undefined &&
    (resolvedSymbol(node.getExpression())?.getDeclarations() ?? []).includes(member.getParent());
};

