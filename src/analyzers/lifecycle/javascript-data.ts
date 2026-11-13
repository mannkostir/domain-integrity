import { BinaryExpression, ClassDeclaration, Node, ParameterDeclaration, ScriptKind, Symbol as MorphSymbol, SyntaxKind } from 'ts-morph';
import { isLibraryNode } from '../shared/library';
import { namedClassChain } from './named-chain';

export type JavaScriptDataProof =
  | { readonly kind: 'data'; readonly constructorAssignments: readonly BinaryExpression[] }
  | { readonly kind: 'unknown' };

const UNKNOWN: JavaScriptDataProof = { kind: 'unknown' };
const PROTOTYPE_OPERATIONS = new Set([
  'prototype', '__proto__', 'constructor', 'getPrototypeOf', 'setPrototypeOf', 'defineProperty', 'defineProperties',
  'getOwnPropertyDescriptor', 'getOwnPropertyDescriptors', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__',
  'Reflect', 'eval', 'Function',
]);

const OPAQUE_REFLECTION = new Set(['Reflect', 'eval', 'Function']);

const accessName = (node: Node): string | undefined => {
  if (Node.isPropertyAccessExpression(node)) return node.getName();
  if (!Node.isElementAccessExpression(node)) return undefined;
  const key = node.getArgumentExpression();
  return Node.isStringLiteral(key) ? key.getLiteralText() : undefined;
};

const thisStoreName = (node: Node): string | undefined => {
  if (!Node.isBinaryExpression(node) || node.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) return undefined;
  const target = node.getLeft();
  if (!Node.isPropertyAccessExpression(target) && !Node.isElementAccessExpression(target)) return undefined;
  if (!Node.isThisExpression(target.getExpression()) || target.hasQuestionDotToken()) return undefined;
  return accessName(target);
};

const isScalarLiteral = (node: Node): boolean =>
  Node.isTrueLiteral(node) || Node.isFalseLiteral(node) || Node.isStringLiteral(node) || Node.isNumericLiteral(node) || Node.isNullLiteral(node) ||
  (Node.isIdentifier(node) && node.getText() === 'undefined' && node.getType().isUndefined() && (node.getSymbol()?.getDeclarations().length ?? 0) === 0);

const isPlainParameter = (parameter: ParameterDeclaration): boolean => {
  const value = parameter.getInitializer();
  return Node.isIdentifier(parameter.getNameNode()) && !parameter.isRestParameter() && (value === undefined || isScalarLiteral(value));
};

const constructorStores = (cls: ClassDeclaration): readonly BinaryExpression[] | undefined => {
  const constructors = cls.getConstructors();
  if (constructors.length === 0) return [];
  if (constructors.length !== 1) return undefined;
  const [constructor] = constructors;
  const body = constructor?.getBody();
  if (!constructor || !Node.isBlock(body) || !constructor.getParameters().every(isPlainParameter)) return undefined;
  const statements = body.getStatements();
  const derived = cls.getExtends() !== undefined;
  const stores: BinaryExpression[] = [];
  for (const [index, statement] of statements.entries()) {
    if (!Node.isExpressionStatement(statement)) return undefined;
    const expression = statement.getExpression();
    if (derived && index === 0) {
      if (!Node.isCallExpression(expression) || !Node.isSuperExpression(expression.getExpression()) || !expression.getArguments().every(isScalarLiteral)) return undefined;
    } else {
      if (!Node.isBinaryExpression(expression) || thisStoreName(expression) === undefined || !isScalarLiteral(expression.getRight())) return undefined;
      stores.push(expression);
    }
  }
  return derived && statements.length === 0 ? undefined : stores;
};

const isJavaScriptClass = (cls: ClassDeclaration): boolean => {
  const kind = cls.getSourceFile().getScriptKind();
  return !isLibraryNode(cls) && (kind === ScriptKind.JS || kind === ScriptKind.JSX) && cls.getProject().getCompilerOptions().allowJs === true;
};

const hasUnsupportedMembers = (cls: ClassDeclaration): boolean =>
  cls.getProperties().length > 0 || cls.getDescendantsOfKind(SyntaxKind.Decorator).length > 0 ||
  cls.getMembers().some((member) =>
    member.getKind() === SyntaxKind.ClassStaticBlockDeclaration ||
    ((Node.isMethodDeclaration(member) || Node.isGetAccessorDeclaration(member) || Node.isSetAccessorDeclaration(member)) && Node.isComputedPropertyName(member.getNameNode())),
  );

const literalKey = (node: Node | undefined): string | undefined => {
  if (node === undefined) return undefined;
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) return node.getLiteralText();
  const value = node.getType().getLiteralValue();
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
};

const propertyKey = (node: Node): string | undefined => {
  if (Node.isComputedPropertyName(node)) return literalKey(node.getExpression());
  return Node.isIdentifier(node) ? (node.getSymbol()?.getName() ?? node.getText()) : literalKey(node);
};

const interferesWithPrototype = (name: string | undefined): boolean =>
  name === undefined || PROTOTYPE_OPERATIONS.has(name);

const isPotentialPrototypeOperation = (node: Node): boolean => {
  if (Node.isIdentifier(node) && OPAQUE_REFLECTION.has(node.getSymbol()?.getName() ?? node.getText())) return true;
  if (Node.isPropertyAccessExpression(node)) return interferesWithPrototype(propertyKey(node.getNameNode()));
  if (Node.isElementAccessExpression(node)) return interferesWithPrototype(literalKey(node.getArgumentExpression()));
  if (Node.isBindingElement(node) && Node.isObjectBindingPattern(node.getParent())) {
    return node.getDotDotDotToken() !== undefined || interferesWithPrototype(propertyKey(node.getPropertyNameNode() ?? node.getNameNode()));
  }
  if (Node.isPropertyAssignment(node) || Node.isShorthandPropertyAssignment(node)) {
    return interferesWithPrototype(propertyKey(node.getNameNode()));
  }
  return false;
};

const hasPrototypeInterference = (cls: ClassDeclaration): boolean =>
  cls.getProject().getSourceFiles().filter((file) => !isLibraryNode(file)).some((file) =>
    file.getDescendants().some(isPotentialPrototypeOperation),
  );

const isConstructionReference = (reference: Node): boolean => {
  const parent = reference.getParent();
  return (Node.isNewExpression(parent) && parent.getExpression() === reference) ||
    (Node.isExpressionWithTypeArguments(parent) && parent.getExpression() === reference && parent.getParentIfKind(SyntaxKind.HeritageClause)?.getToken() === SyntaxKind.ExtendsKeyword) ||
    Node.isImportSpecifier(parent) || Node.isImportClause(parent) || Node.isExportSpecifier(parent);
};

const hasConstructorEscape = (cls: ClassDeclaration): boolean => {
  const name = cls.getNameNode();
  return name === undefined || name.findReferencesAsNodes().some((reference) => reference !== name && !isConstructionReference(reference));
};

const interceptsStore = (chain: readonly ClassDeclaration[], name: string): boolean =>
  name === '__proto__' || name === 'constructor' || chain.some((cls) =>
    [...cls.getMethods(), ...cls.getGetAccessors(), ...cls.getSetAccessors()].some((member) => {
      if (member.isStatic()) return false;
      const memberName = member.getSymbol()?.getName();
      return memberName === undefined || memberName === name;
    }),
  );

const isOwnedDeclaration = (node: Node, chain: readonly ClassDeclaration[], name: string): boolean => {
  if (thisStoreName(node) !== name) return false;
  const statement = node.getParent();
  const block = statement?.getParent();
  const implementation = block?.getParent();
  const owner = implementation?.getParent();
  return Node.isExpressionStatement(statement) && Node.isBlock(block) &&
    (Node.isConstructorDeclaration(implementation) || (Node.isMethodDeclaration(implementation) && !implementation.isStatic())) &&
    implementation.getBody() === block && Node.isClassDeclaration(owner) && chain.includes(owner);
};

export const proveJavaScriptDataProperty = (
  cls: ClassDeclaration,
  symbol: MorphSymbol | undefined,
): JavaScriptDataProof => {
  if (!isJavaScriptClass(cls) || symbol === undefined || cls.getType().getProperty(symbol.getName()) !== symbol) return UNKNOWN;
  const chain = namedClassChain(cls);
  if (chain === undefined || !chain.every(isJavaScriptClass) || chain.some(hasUnsupportedMembers) || hasPrototypeInterference(cls) || chain.some(hasConstructorEscape)) return UNKNOWN;
  const stores = [...chain].reverse().map(constructorStores);
  if (stores.some((assignments) => assignments === undefined)) return UNKNOWN;
  const assignments = stores.flatMap((entry) => entry ?? []);
  if (assignments.some((assignment) => {
    const name = thisStoreName(assignment);
    return name === undefined || interceptsStore(chain, name);
  })) return UNKNOWN;
  const declarations = symbol.getDeclarations();
  if (declarations.length === 0 || !declarations.every((node) => isOwnedDeclaration(node, chain, symbol.getName()))) return UNKNOWN;
  const constructorAssignments = assignments.filter((assignment) => thisStoreName(assignment) === symbol.getName());
  return constructorAssignments.length === 0 ? UNKNOWN : { kind: 'data', constructorAssignments };
};
