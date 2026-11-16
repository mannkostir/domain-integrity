import { BinaryExpression, ClassDeclaration, Node, ParameterDeclaration, Project, ScriptKind, SourceFile, Symbol as MorphSymbol, SyntaxKind } from 'ts-morph';
import { isLibraryNode } from '../shared/library';
import { SourceIndex } from '../shared/source-index';
import { namedClassChain } from './named-chain';

export type JavaScriptDataProof =
  | { readonly kind: 'data'; readonly constructorAssignments: readonly BinaryExpression[] }
  | { readonly kind: 'unknown' };

const UNKNOWN = { kind: 'unknown' } as const;
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

const isConstructorValue = (node: Node, parameters: ReadonlySet<MorphSymbol>): boolean => {
  if (isScalarLiteral(node)) return true;
  const symbol = Node.isIdentifier(node) ? node.getSymbol() : undefined;
  return symbol !== undefined && parameters.has(symbol);
};

const constructorStores = (cls: ClassDeclaration): readonly BinaryExpression[] | undefined => {
  const constructors = cls.getConstructors();
  if (constructors.length === 0) return [];
  if (constructors.length !== 1) return undefined;
  const [constructor] = constructors;
  const body = constructor?.getBody();
  if (!constructor || !Node.isBlock(body) || !constructor.getParameters().every(isPlainParameter)) return undefined;
  const parameters = new Set(constructor.getParameters().flatMap((parameter) => {
    const symbol = parameter.getSymbol();
    return symbol === undefined ? [] : [symbol];
  }));
  const statements = body.getStatements();
  const derived = cls.getExtends() !== undefined;
  const stores: BinaryExpression[] = [];
  for (const [index, statement] of statements.entries()) {
    if (!Node.isExpressionStatement(statement)) return undefined;
    const expression = statement.getExpression();
    if (derived && index === 0) {
      if (!Node.isCallExpression(expression) || !Node.isSuperExpression(expression.getExpression()) || !expression.getArguments().every((argument) => isConstructorValue(argument, parameters))) return undefined;
    } else {
      if (!Node.isBinaryExpression(expression) || thisStoreName(expression) === undefined || !isConstructorValue(expression.getRight(), parameters)) return undefined;
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

const hasPrototypeInterference = (files: readonly SourceFile[]): boolean =>
  files.some((file) =>
    file.getDescendants().some(isPotentialPrototypeOperation),
  );

const isConstructionReference = (reference: Node): boolean => {
  const parent = reference.getParent();
  return (Node.isNewExpression(parent) && parent.getExpression() === reference) ||
    (Node.isExpressionWithTypeArguments(parent) && parent.getExpression() === reference && parent.getParentIfKind(SyntaxKind.HeritageClause)?.getToken() === SyntaxKind.ExtendsKeyword) ||
    Node.isImportSpecifier(parent) || Node.isImportClause(parent) || Node.isExportSpecifier(parent);
};

const hasConstructorEscape = (cls: ClassDeclaration, runtimeFiles: ReadonlySet<SourceFile>): boolean => {
  const name = cls.getNameNode();
  return name === undefined || name.findReferencesAsNodes().some((reference) => reference !== name && runtimeFiles.has(reference.getSourceFile()) && !isConstructionReference(reference));
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
    (Node.isConstructorDeclaration(implementation) ||
      ((Node.isMethodDeclaration(implementation) || Node.isSetAccessorDeclaration(implementation)) && !implementation.isStatic())) &&
    implementation.getBody() === block && Node.isClassDeclaration(owner) && chain.includes(owner);
};

type ClassConstruction = {
  readonly chain: readonly ClassDeclaration[];
  readonly assignments: readonly BinaryExpression[];
};

export class JavaScriptDataProperties {
  private readonly files: readonly SourceFile[];
  private readonly included: ReadonlySet<SourceFile>;
  private readonly project: Project | undefined;
  private readonly validSources: boolean;
  private prototypeInterference: boolean | undefined;
  private readonly classes = new Map<ClassDeclaration, ClassConstruction | undefined>();
  private readonly properties = new Map<ClassDeclaration, Map<MorphSymbol, JavaScriptDataProof>>();

  constructor(runtimeSources: SourceIndex) {
    this.files = [...runtimeSources.files];
    this.included = new Set(this.files);
    this.project = this.files[0]?.getProject();
    this.validSources = this.project !== undefined && this.files.every((file) =>
      !file.wasForgotten() && file.getProject() === this.project && this.project?.getSourceFile(file.getFilePath()) === file,
    );
  }

  prove(cls: ClassDeclaration, symbol: MorphSymbol | undefined): JavaScriptDataProof {
    if (!this.validSources || cls.wasForgotten() || !this.included.has(cls.getSourceFile()) || cls.getProject() !== this.project || !isJavaScriptClass(cls)) return UNKNOWN;
    if (symbol === undefined || cls.getType().getProperty(symbol.getName()) !== symbol) return UNKNOWN;
    let cached = this.properties.get(cls);
    if (cached === undefined) {
      cached = new Map();
      this.properties.set(cls, cached);
    }
    const known = cached.get(symbol);
    if (known !== undefined) return known;
    const proof = this.proveProperty(cls, symbol);
    cached.set(symbol, proof);
    return proof;
  }

  private constructionOf(cls: ClassDeclaration): ClassConstruction | undefined {
    if (this.classes.has(cls)) return this.classes.get(cls);
    const construction = this.proveConstruction(cls);
    this.classes.set(cls, construction);
    return construction;
  }

  private proveConstruction(cls: ClassDeclaration): ClassConstruction | undefined {
    const chain = namedClassChain(cls);
    if (chain === undefined || !chain.every((member) => this.included.has(member.getSourceFile()) && isJavaScriptClass(member)) || chain.some(hasUnsupportedMembers)) return undefined;
    this.prototypeInterference ??= hasPrototypeInterference(this.files);
    if (this.prototypeInterference || chain.some((member) => hasConstructorEscape(member, this.included))) return undefined;
    const stores = [...chain].reverse().map(constructorStores);
    if (stores.some((assignments) => assignments === undefined)) return undefined;
    const assignments = stores.flatMap((entry) => entry ?? []);
    if (assignments.some((assignment) => {
      const name = thisStoreName(assignment);
      return name === undefined || interceptsStore(chain, name);
    })) return undefined;
    return { chain, assignments };
  }

  private proveProperty(cls: ClassDeclaration, symbol: MorphSymbol): JavaScriptDataProof {
    const construction = this.constructionOf(cls);
    if (construction === undefined) return UNKNOWN;
    const declarations = symbol.getDeclarations();
    if (declarations.length === 0 || !declarations.every((node) => isOwnedDeclaration(node, construction.chain, symbol.getName()))) return UNKNOWN;
    const constructorAssignments = construction.assignments.filter((assignment) => thisStoreName(assignment) === symbol.getName());
    return constructorAssignments.length === 0 ? UNKNOWN : { kind: 'data', constructorAssignments };
  }
}
