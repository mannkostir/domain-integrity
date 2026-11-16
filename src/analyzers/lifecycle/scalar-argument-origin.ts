import { ClassDeclaration, MethodDeclaration, Node, ParameterDeclaration, SyntaxKind, Type, ts } from 'ts-morph';
import { isPlainArrayPush, isPushOnlyMethod } from '../shared/array-store';
import { isDefaultLibraryNode, isLibraryNode } from '../shared/library';
import { SourceIndex } from '../shared/source-index';
import { isWritten } from '../shared/writes';
import { outermostWrapper } from '../shared/wrappers';
import { hasAmbiguousInstanceShape, hasForeignThis, MAX_GETTER_DEPTH } from './field-ref';
import { namedClassChain } from './named-chain';
import { isPlainDataPathFromThis } from './state-assignment';
import { defaultLibraryOperation, defaultLibraryOperations, isRuntimeReference } from './runtime-dependencies';

type Work = { remaining: number };
type RuntimeUse = {
  readonly node: Node;
  readonly declarations: readonly Node[];
  readonly implementation: Node | undefined;
  readonly unprovedApi: boolean;
};
const take = (work: Work): boolean => work.remaining-- > 0;
const primitiveDataRepresentation = (type: Type, work: Work, active: ReadonlySet<Type> = new Set(), depth = 0): boolean => {
  if (!take(work) || depth >= MAX_GETTER_DEPTH || active.has(type) || type.isIntersection() || type.isTypeParameter()) return false;
  if (type.isUnion()) {
    const members = type.getUnionTypes();
    const next = new Set([...active, type]);
    return members.length > 0 && members.every(member => primitiveDataRepresentation(member, work, next, depth + 1));
  }
  return (type.getFlags() & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike |
    ts.TypeFlags.BigIntLike | ts.TypeFlags.ESSymbolLike | ts.TypeFlags.Null | ts.TypeFlags.Undefined)) !== 0;
};
const unparenthesized = (node: Node): Node => {
  let current = node;
  for (let depth = 0; depth < MAX_GETTER_DEPTH && Node.isParenthesizedExpression(current); depth++) current = current.getExpression();
  return current;
};

const maySelectMember = (node: Node, name: string): boolean => {
  if (Node.isPropertyAccessExpression(node)) return node.getName() === name;
  if (!Node.isElementAccessExpression(node)) return false;
  const argument = node.getArgumentExpression();
  const key = argument === undefined ? undefined : unparenthesized(argument);
  return (!Node.isStringLiteral(key) && !Node.isNoSubstitutionTemplateLiteral(key)) || key.getLiteralText() === name;
};

const selectedDeclarations = (node: Node): readonly Node[] => {
  if (Node.isPropertyAccessExpression(node)) return node.getNameNode().getSymbol()?.getDeclarations() ?? [];
  if (Node.isElementAccessExpression(node)) {
    const key = node.getArgumentExpression();
    if (Node.isStringLiteral(key) || Node.isNoSubstitutionTemplateLiteral(key)) return node.getExpression().getType().getProperty(key.getLiteralText())?.getDeclarations() ?? [];
    return [];
  }
  return node.getSymbol()?.getDeclarations() ?? [];
};

const boundedDataPath = (node: Node): boolean => {
  let current = node;
  for (let depth = 0; depth < MAX_GETTER_DEPTH; depth++) {
    if (!Node.isPropertyAccessExpression(current) && !Node.isElementAccessExpression(current)) return false;
    current = current.getExpression();
    if (Node.isThisExpression(current)) return isPlainDataPathFromThis(node);
  }
  return false;
};

const exposesLibraryApi = (node: Node, declarations: readonly Node[]): boolean => {
  const type = Node.isExpression(node) ? node.getType() : undefined;
  const observed = [
    ...declarations,
    ...(type?.getSymbol()?.getDeclarations() ?? []),
    ...(type?.getCallSignatures().map(signature => signature.getDeclaration()) ?? []),
  ];
  return observed.some(declaration => defaultLibraryOperation(declaration) !== undefined ||
    (isDefaultLibraryNode(declaration) &&
      ((Node.isModuleDeclaration(declaration) && declaration.getName() === 'Reflect') ||
        (Node.isVariableDeclaration(declaration) && declaration.getName() === 'Object') ||
        (Node.isInterfaceDeclaration(declaration) && ['ObjectConstructor', 'Function', 'CallableFunction', 'NewableFunction'].includes(declaration.getName())))));
};

const literalData = (node: Node, work: Work, depth: number): boolean => {
  if (!take(work) || depth >= MAX_GETTER_DEPTH) return false;
  if (Node.isParenthesizedExpression(node)) return literalData(node.getExpression(), work, depth);
  if (Node.isObjectLiteralExpression(node)) {
    return node.getProperties().every(property => {
      if (!take(work) || !Node.isPropertyAssignment(property)) return false;
      const key = property.getNameNode();
      if ((!Node.isIdentifier(key) && !Node.isStringLiteral(key) && !Node.isNumericLiteral(key)) || (Node.isStringLiteral(key) ? key.getLiteralText() : key.getText()) === '__proto__') return false;
      return literalData(property.getInitializerOrThrow(), work, depth + 1);
    });
  }
  return Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node) || Node.isNumericLiteral(node) ||
    Node.isBigIntLiteral(node) || Node.isTrueLiteral(node) || Node.isFalseLiteral(node) || Node.isNullLiteral(node) ||
    (Node.isPrefixUnaryExpression(node) && node.getOperatorToken() === SyntaxKind.MinusToken &&
      (Node.isNumericLiteral(node.getOperand()) || Node.isBigIntLiteral(node.getOperand())));
};

export class UnrelatedParameterOrigins {
  private uses: readonly RuntimeUse[] | undefined;
  constructor(private readonly sources: SourceIndex) {}

  private runtimeUses(): readonly RuntimeUse[] {
    this.uses ??= this.sources.files.flatMap(file => file.getDescendants().filter(node => {
      if (!isRuntimeReference(node)) return false;
      if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node) || Node.isBindingElement(node) || Node.isCallExpression(node) || Node.isNewExpression(node)) return true;
      if (!Node.isIdentifier(node) && !Node.isPrivateIdentifier(node)) return false;
      const parent = node.getParent();
      if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === node) return false;
      if ((Node.isMethodDeclaration(parent) || Node.isParameterDeclaration(parent) || Node.isClassDeclaration(parent) ||
        Node.isPropertyDeclaration(parent)) && parent.getNameNode() === node) return false;
      return true;
    }).map(node => {
      const symbol = Node.isPropertyAccessExpression(node) ? node.getNameNode().getSymbol() : node.getSymbol();
      const parent = node.getParent();
      const call = Node.isCallExpression(node) || Node.isNewExpression(node) ? node : (Node.isCallExpression(parent) || Node.isNewExpression(parent)) && parent.getExpression() === node ? parent : undefined;
      const implementation = call?.getProject().getTypeChecker().getResolvedSignature(call)?.getDeclaration();
      const declarations = symbol?.getDeclarations() ?? [];
      const unprovedApi = exposesLibraryApi(node, declarations) ||
        (Node.isCallExpression(node) && defaultLibraryOperations(node).length > 0);
      return { node, declarations, implementation, unprovedApi };
    }));
    return this.uses;
  }

  private admittedInvocation(node: Node, implementation: Node | undefined, chain: readonly ClassDeclaration[], method: MethodDeclaration, arrays: ReadonlySet<Node>, work: Work): boolean {
    if (!Node.isCallExpression(node) && !Node.isNewExpression(node)) return true;
    if (!take(work) || implementation === undefined || node.getTypeArguments().length > 0) return false;
    const callee = unparenthesized(node.getExpression());
    const context = node.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
    if (Node.isNewExpression(node)) {
      if (Node.isIdentifier(callee) && callee.getText() === 'Error' && isDefaultLibraryNode(implementation) &&
        implementation.getParentIfKind(SyntaxKind.InterfaceDeclaration)?.getName() === 'ErrorConstructor') {
        const declarations = callee.getSymbol()?.getDeclarations() ?? [];
        return declarations.length > 0 && declarations.every(isDefaultLibraryNode) &&
          node.getArguments().length === 1 && Node.isStringLiteral(node.getArguments()[0]);
      }
      const declarations = callee.getSymbol()?.getDeclarations() ?? [];
      return Node.isIdentifier(callee) && declarations.length === 1 && Node.isClassDeclaration(declarations[0]) &&
        chain.includes(declarations[0]) && Node.isConstructorDeclaration(implementation) && Node.isClassDeclaration(implementation.getParent()) && chain.includes(implementation.getParent() as ClassDeclaration);
    }
    if (node.hasQuestionDotToken() || node.getArguments().some(Node.isSpreadElement)) return false;
    if (Node.isSuperExpression(callee)) return context !== undefined && chain.includes(context) && !hasForeignThis(node) &&
      Node.isConstructorDeclaration(implementation) && Node.isClassDeclaration(implementation.getParent()) && chain.includes(implementation.getParent() as ClassDeclaration);
    if (!Node.isPropertyAccessExpression(callee) || callee.hasQuestionDotToken()) return false;
    const receiver = callee.getExpression();
    if (Node.isThisExpression(receiver) || Node.isSuperExpression(receiver)) {
      if (context === undefined || !chain.includes(context) || hasForeignThis(callee) || !Node.isMethodDeclaration(implementation) ||
        !chain.includes(implementation.getParent() as ClassDeclaration) || implementation.isStatic() || implementation.isAsync() ||
        implementation.isGenerator() || implementation.isOverload() || implementation.getBody() === undefined ||
        implementation.getDecorators().length > 0 || isWritten(outermostWrapper(callee))) return false;
      const selected = chain[0]?.getType().getProperty(callee.getName())?.getDeclarations() ?? [];
      return selected.length === 1 && selected[0] === implementation &&
        (implementation === method || node.getArguments().length === 0);
    }
    if (callee.getName() !== 'push' || !isDefaultLibraryNode(implementation) ||
      implementation.getParentIfKind(SyntaxKind.InterfaceDeclaration)?.getName() !== 'Array' ||
      context === undefined || !chain.includes(context) || hasForeignThis(callee)) return false;
    if (isPlainArrayPush(receiver, arrays)) return node.getFirstAncestorByKind(SyntaxKind.MethodDeclaration) === method;
    if (!boundedDataPath(receiver) || !receiver.getType().isArray()) return false;
    const element = receiver.getType().getArrayElementType();
    if (element === undefined || !(element.isString() || element.isNumber() || element.isBoolean())) return false;
    return node.getArguments().every(argument => {
      if (!take(work)) return false;
      if (Node.isStringLiteral(argument) || Node.isNumericLiteral(argument) || Node.isTrueLiteral(argument) || Node.isFalseLiteral(argument)) return true;
      if (!Node.isIdentifier(argument)) return false;
      const declarations = argument.getSymbol()?.getDeclarations() ?? [];
      const parameter = declarations[0];
      if (declarations.length !== 1 || !Node.isParameterDeclaration(parameter) || parameter.getParent() !== node.getFirstAncestorByKind(SyntaxKind.MethodDeclaration) ||
        parameter.isOptional() || parameter.isRestParameter() || parameter.getInitializer() !== undefined) return false;
      const type = parameter.getType();
      if (!(type.isString() || type.isNumber() || type.isBoolean())) return false;
      return parameter.getParent().getDescendants().every(use => take(work) &&
        (!Node.isIdentifier(use) || use.getSymbol() !== parameter.getSymbol() || !isWritten(outermostWrapper(use))));
    });
  }

  private admittedExposure(node: Node, chain: readonly ClassDeclaration[], method: MethodDeclaration, work: Work): boolean {
    if (!Node.isIdentifier(node) && !Node.isPropertyAccessExpression(node) && !Node.isElementAccessExpression(node)) return true;
    const parent = outermostWrapper(node).getParent();
    if ((Node.isCallExpression(parent) || Node.isNewExpression(parent)) && parent.getExpression() === outermostWrapper(node)) return true;
    if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
      const declarations = selectedDeclarations(node);
      if (declarations.length === 1 && Node.isEnumMember(declarations[0])) return true;
      const context = node.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
      if (context === undefined || !chain.includes(context) || hasForeignThis(node)) return false;
      if (boundedDataPath(node)) {
        const type = node.getType();
        if (type.isAny() || type.isUnknown() || type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0) return false;
        if ((Node.isPropertyAccessExpression(parent) || Node.isElementAccessExpression(parent)) && parent.getExpression() === node) return true;
        if (Node.isBinaryExpression(parent) && parent.getLeft() === node && parent.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
          node.getFirstAncestorByKind(SyntaxKind.Constructor) !== undefined) return true;
        return primitiveDataRepresentation(type, work);
      }
      if (!Node.isPropertyAccessExpression(node) || !Node.isThisExpression(node.getExpression())) return false;
      return declarations.length === 1 && Node.isGetAccessorDeclaration(declarations[0]) &&
        Node.isClassDeclaration(declarations[0].getParent()) && chain.includes(declarations[0].getParent() as ClassDeclaration);
    }
    if ((Node.isPropertyAccessExpression(parent) || Node.isElementAccessExpression(parent)) && parent.getExpression() === node) {
      const declarations = selectedDeclarations(parent);
      if (declarations.length === 1 && Node.isEnumMember(declarations[0])) return true;
    }
    const declarations = node.getSymbol()?.getDeclarations() ?? [];
    const parameter = declarations[0];
    if (declarations.length === 1 && Node.isParameterDeclaration(parameter)) {
      if (parameter.getParent() === method) return true;
      const owner = parameter.getParent();
      const type = parameter.getType();
      if (!type.isAny() && !type.isUnknown() && type.getCallSignatures().length === 0 && type.getConstructSignatures().length === 0 &&
        Node.isConstructorDeclaration(owner) && Node.isClassDeclaration(owner.getParent()) && chain.includes(owner.getParent() as ClassDeclaration)) {
        if (Node.isBinaryExpression(parent) && parent.getRight() === node && parent.getOperatorToken().getKind() === SyntaxKind.EqualsToken && boundedDataPath(parent.getLeft())) return true;
        if (Node.isCallExpression(parent) && Node.isSuperExpression(parent.getExpression()) && parent.getArguments().includes(node)) return true;
      }
    }
    const type = node.getType();
    return primitiveDataRepresentation(type, work);
  }

  private closedHierarchy(method: MethodDeclaration, chain: readonly ClassDeclaration[], work: Work): boolean {
    const owner = method.getParent();
    if (!Node.isClassDeclaration(owner) || !chain.includes(owner)) return false;
    const classes = this.sources.ofKind(SyntaxKind.ClassDeclaration);
    for (const cls of classes) {
      if (!take(work)) return false;
      const lineage = namedClassChain(cls);
      if (lineage === undefined || lineage.length > MAX_GETTER_DEPTH) return false;
      if (!lineage.includes(owner)) continue;
      if (lineage.some(candidate => !take(work) || !this.sources.files.includes(candidate.getSourceFile()) || isLibraryNode(candidate) ||
        hasAmbiguousInstanceShape(candidate) || candidate.getSymbol()?.getDeclarations().length !== 1 ||
        candidate.getDescendantsOfKind(SyntaxKind.Decorator).length > 0)) return false;
      const declarations = cls.getType().getProperty(method.getName())?.getDeclarations() ?? [];
      if (declarations.length !== 1 || declarations[0] !== method) return false;
      if (lineage.some(candidate => candidate.getInstanceMembers().some(member => !take(work) || (member !== method && member.getName() === method.getName())))) return false;
    }
    return true;
  }

  private terminalParameter(argument: Node, parameter: ParameterDeclaration, method: MethodDeclaration, arrays: ReadonlySet<Node>, work: Work): boolean {
    if (!isPushOnlyMethod(method, arrays)) return false;
    const body = method.getBody();
    const statements = Node.isBlock(body) ? body.getStatements() : [];
    const statement = statements[0];
    if (statements.length !== 1 || !Node.isExpressionStatement(statement)) return false;
    const call = statement.getExpression();
    if (!Node.isCallExpression(call) || call.getArguments().length !== 1 || unparenthesized(call.getArguments()[0]!) !== argument) return false;
    const member = call.getExpression();
    if (!Node.isPropertyAccessExpression(member) || !isPlainArrayPush(member.getExpression(), arrays)) return false;
    const symbol = parameter.getSymbol();
    let count = 0;
    for (const node of method.getDescendants()) {
      if (!take(work)) return false;
      if (Node.isIdentifier(node) && node.getText() === 'arguments') return false;
      if (node !== parameter.getNameNode() && Node.isIdentifier(node) && node.getSymbol() === symbol) {
        if (node !== argument) return false;
        count++;
      }
    }
    return count === 1;
  }

  proves(argument: Node, chain: readonly ClassDeclaration[], arrays: ReadonlySet<Node>): boolean {
    const candidate = unparenthesized(argument);
    if (!Node.isIdentifier(candidate)) return false;
    const declarations = candidate.getSymbol()?.getDeclarations() ?? [];
    const parameter = declarations[0];
    if (declarations.length !== 1 || !Node.isParameterDeclaration(parameter) || !Node.isIdentifier(parameter.getNameNode()) ||
      parameter.isOptional() || parameter.isRestParameter() || parameter.getInitializer() !== undefined ||
      parameter.getDecorators().length > 0 || parameter.isParameterProperty()) return false;
    const method = parameter.getParent();
    if (!Node.isMethodDeclaration(method) || !this.sources.files.includes(method.getSourceFile()) || isLibraryNode(method) ||
      (!method.hasModifier(SyntaxKind.PrivateKeyword) && !method.hasModifier(SyntaxKind.ProtectedKeyword) && !Node.isPrivateIdentifier(method.getNameNode())) ||
      method.getParameters().length !== 1 || method.getTypeParameters().length > 0 || method.isAbstract() || method.isOverload() || method.hasModifier(SyntaxKind.DeclareKeyword)) return false;
    const owner = method.getParent();
    if (!Node.isClassDeclaration(owner)) return false;
    const work = { remaining: 256 };
    if (!this.terminalParameter(candidate, parameter, method, arrays, work) || !this.closedHierarchy(method, chain, work)) return false;
    const selectedChain = chain[0] === undefined ? undefined : namedClassChain(chain[0]);
    if (selectedChain === undefined || selectedChain.length > MAX_GETTER_DEPTH) return false;
    let calls = 0;
    for (const indexed of this.runtimeUses()) {
      if (!take(work) || indexed.unprovedApi || !this.admittedInvocation(indexed.node, indexed.implementation, selectedChain, method, arrays, work) || !this.admittedExposure(indexed.node, selectedChain, method, work)) return false;
      const { node: use, declarations: targets } = indexed;
      const exact = targets.includes(method);
      if (Node.isBindingElement(use)) {
        return false;
      }
      if (!exact) {
        if (maySelectMember(use, method.getName())) return false;
        continue;
      }
      if (!Node.isPropertyAccessExpression(use) || use.hasQuestionDotToken() ||
        (!Node.isThisExpression(use.getExpression()) && !Node.isSuperExpression(use.getExpression())) || isWritten(outermostWrapper(use))) return false;
      const caller = use.getParent();
      if (!Node.isCallExpression(caller) || caller.getExpression() !== use || caller.hasQuestionDotToken() ||
        caller.getArguments().length !== 1 || caller.getTypeArguments().length > 0 || targets.length !== 1 ||
        indexed.implementation !== method) return false;
      const actual = caller.getArguments()[0]!;
      if (!Node.isObjectLiteralExpression(unparenthesized(actual)) || !literalData(actual, work, 0)) return false;
      const context = use.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
      const lineage = context === undefined ? undefined : namedClassChain(context);
      if (lineage === undefined || !lineage.includes(owner)) return false;
      calls++;
    }
    return calls > 0;
  }
}
