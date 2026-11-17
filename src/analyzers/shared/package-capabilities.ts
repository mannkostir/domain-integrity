import { Node, Symbol, SyntaxKind, Type, ts } from 'ts-morph';

type Context = { readonly id: number; readonly bindings: ReadonlyMap<ts.Node, Work> };
type Work = ({ readonly kind: 'node'; readonly value: Node } | { readonly kind: 'type'; readonly value: Type }) & { readonly context: Context };
export type PackageCapability = { readonly kind: 'exposed' | 'unrelated' | 'incomplete'; readonly visited: number; readonly cause: string | undefined };

const within = (file: string, root: string): boolean => file.replace(/\\/g, '/').startsWith(root.replace(/\\/g, '/') + '/');

export class PackageCapabilities {
  private readonly results = new Map<Node, PackageCapability>();

  constructor(private readonly root: string) {}

  query(binding: Node, surfaces: readonly Node[]): PackageCapability {
    const cached = this.results.get(binding);
    if (cached !== undefined) return cached;
    const candidates = [...new Set(surfaces.length === 0 ? [binding] : surfaces)];
    const seeds = candidates.filter((candidate) => !candidates.some((other) => other !== candidate &&
      other.getSourceFile() === candidate.getSourceFile() && other.getStart() <= candidate.getStart() && other.getEnd() >= candidate.getEnd()));
    const result = this.reachable(seeds);
    this.results.set(binding, result);
    return result;
  }

  private reachable(seeds: readonly Node[]): PackageCapability {
    const queue: Work[] = [];
    const seen = new Set<string>();
    const identities = new Map<object, number>();
    const contexts = new Map<string, Context>();
    const empty: Context = { id: 0, bindings: new Map() };
    contexts.set('', empty);
    let visited = 0;
    let cause: string | undefined;
    let exposed = false;
    const identity = (value: object): number => {
      const cached = identities.get(value);
      if (cached !== undefined) return cached;
      const id = identities.size;
      identities.set(value, id);
      return id;
    };
    const workKey = (work: Work): string => `${work.kind}:${identity(work.kind === 'node' ? work.value.compilerNode : work.value.compilerType)}:${work.context.id}`;
    const missing = (value: Node) => { cause ??= `unresolved ${value.getKindName()}: ${value.getText().slice(0, 80)}`; };
    const charge = (): boolean => {
      if (++visited <= 64) return true;
      cause ??= 'package capability work limit';
      return false;
    };
    const contextFor = (bindings: ReadonlyMap<ts.Node, Work>): Context | undefined => {
      const key = [...bindings].map(([parameter, work]) => `${identity(parameter)}=${workKey(work)}`).sort().join(';');
      const cached = contexts.get(key);
      if (cached !== undefined) return cached;
      if (contexts.size >= 64) { cause ??= 'package capability substitution limit'; return undefined; }
      const context: Context = { id: contexts.size, bindings };
      contexts.set(key, context);
      return context;
    };
    const defaultLibrary = (value: Node): boolean => value.getProject().getProgram().compilerObject.isSourceFileDefaultLibrary(value.getSourceFile().compilerNode);
    const primitive = (value: Type): boolean => value.isAny() || value.isUnknown() ||
      (value.getFlags() & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike | ts.TypeFlags.Void | ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Never | ts.TypeFlags.BigIntLike | ts.TypeFlags.ESSymbolLike | ts.TypeFlags.NonPrimitive)) !== 0;
    const enqueue = (work: Work): void => {
      const key = workKey(work);
      if (seen.has(key)) return;
      seen.add(key);
      if (work.kind === 'node') {
        const value = work.value;
        if (within(value.getSourceFile().getFilePath(), this.root)) { exposed = true; return; }
        if (defaultLibrary(value) && work.context.bindings.size === 0) return;
        if ([SyntaxKind.StringKeyword, SyntaxKind.NumberKeyword, SyntaxKind.BooleanKeyword, SyntaxKind.VoidKeyword,
          SyntaxKind.AnyKeyword, SyntaxKind.UnknownKeyword, SyntaxKind.ObjectKeyword, SyntaxKind.UndefinedKeyword,
          SyntaxKind.NeverKeyword, SyntaxKind.BigIntKeyword, SyntaxKind.SymbolKeyword].includes(value.getKind())) return;
        if (Node.isTypeNode(value) || charge()) queue.push(work);
      } else if (!primitive(work.value) && charge()) queue.push(work);
    };
    const boundWork = (work: Work, active = new Set<string>()): Work => {
      const key = workKey(work);
      if (active.has(key) || active.size >= 64) return work;
      const declarations = work.kind === 'node' && Node.isTypeReference(work.value) ? work.value.getTypeName().getSymbol()?.getDeclarations() :
        work.kind === 'type' ? work.value.getSymbol()?.getDeclarations() : undefined;
      const parameter = declarations?.length === 1 ? declarations[0] : undefined;
      const bound = Node.isTypeParameterDeclaration(parameter) ? work.context.bindings.get(parameter.compilerNode) : undefined;
      return bound === undefined ? work : boundWork(bound, new Set([...active, key]));
    };
    const instantiate = (declaration: Node, arguments_: readonly Work[], caller: Context): Context | undefined => {
      if (!Node.isTypeParametered(declaration)) return caller;
      const parameters = declaration.getTypeParameters();
      if (parameters.length === 0) return caller;
      let bindings = new Map(caller.bindings);
      parameters.forEach((parameter) => bindings.delete(parameter.compilerNode));
      let current = contextFor(bindings);
      if (current === undefined) return undefined;
      for (const [index, parameter] of parameters.entries()) {
        const actual = arguments_[index];
        const fallback = parameter.getDefault();
        const bound = actual ?? (fallback === undefined ? undefined : { kind: 'node' as const, value: fallback, context: current });
        if (bound !== undefined) bindings = new Map([...bindings, [parameter.compilerNode, boundWork(bound)]]);
        current = contextFor(bindings);
        if (current === undefined) return undefined;
      }
      return current;
    };
    const symbol = (value: Symbol | undefined, context: Context, arguments_: readonly Work[] = []): boolean => {
      const target = value?.isAlias() ? value.getAliasedSymbol() : value;
      const declarations = target?.getDeclarations() ?? [];
      if (declarations.length === 0) return false;
      declarations.forEach((declaration) => {
        const instantiated = instantiate(declaration, arguments_, context);
        if (instantiated !== undefined) enqueue({ kind: 'node', value: declaration, context: instantiated });
      });
      return true;
    };
    const processNode = (value: Node, context: Context): void => {
      const node = (value: Node) => enqueue({ kind: 'node', value, context });
      const type = (value: Type) => enqueue({ kind: 'type', value, context });
      const callbackOutputs = (annotation: Node): void => {
        if (Node.isParenthesizedTypeNode(annotation)) { callbackOutputs(annotation.getTypeNode()); return; }
        if (Node.isUnionTypeNode(annotation) || Node.isIntersectionTypeNode(annotation)) { annotation.getTypeNodes().forEach(callbackOutputs); return; }
        if (Node.isFunctionTypeNode(annotation)) annotation.getParameters().forEach((parameter) => {
          const written = parameter.getTypeNode();
          if (written !== undefined) node(written);
        });
      };
      const reference = (target: Symbol | undefined, arguments_: readonly Node[]) => {
        if (!symbol(target, context, arguments_.map((value) => ({ kind: 'node', value, context })))) missing(value);
      };
      if (Node.isTypeReference(value)) { reference(value.getTypeName().getSymbol(), value.getTypeArguments()); return; }
      if (Node.isTypeQuery(value)) { reference(value.getExprName().getSymbol(), value.getTypeArguments()); return; }
      if (Node.isImportTypeNode(value)) {
        reference(value.getQualifier()?.getSymbol() ?? value.getType().getSymbol(), value.getTypeArguments());
        return;
      }
      if (Node.isExpressionWithTypeArguments(value)) { reference(value.getExpression().getSymbol(), value.getTypeArguments()); return; }
      if (Node.isTypeParameterDeclaration(value)) {
        const bound = context.bindings.get(value.compilerNode);
        if (bound !== undefined) { enqueue(bound); return; }
        const fallback = value.getDefault() ?? value.getConstraint();
        if (fallback !== undefined) node(fallback);
        return;
      }
      if (Node.isTypeLiteral(value)) { value.getMembers().forEach(node); return; }
      if (Node.isUnionTypeNode(value) || Node.isIntersectionTypeNode(value)) { value.getTypeNodes().forEach(node); return; }
      if (Node.isArrayTypeNode(value)) { node(value.getElementTypeNode()); return; }
      if (Node.isParenthesizedTypeNode(value)) { node(value.getTypeNode()); return; }
      if (Node.isTupleTypeNode(value)) { value.getElements().forEach(node); return; }
      if (Node.isLiteralTypeNode(value)) return;
      if (Node.isPropertyDeclaration(value) || Node.isPropertySignature(value) || Node.isVariableDeclaration(value)) {
        const written = value.getTypeNode();
        if (written !== undefined) node(written);
        else if (Node.isPropertyDeclaration(value) || Node.isVariableDeclaration(value)) {
          const initial = value.getInitializer();
          if (initial !== undefined) node(initial); else type(value.getType());
        } else type(value.getType());
      } else if (Node.isFunctionDeclaration(value) || Node.isFunctionExpression(value) || Node.isArrowFunction(value) ||
        Node.isMethodDeclaration(value) || Node.isMethodSignature(value) || Node.isGetAccessorDeclaration(value) ||
        Node.isCallSignatureDeclaration(value) || Node.isConstructSignatureDeclaration(value) || Node.isIndexSignatureDeclaration(value) ||
        Node.isFunctionTypeNode(value) || Node.isConstructorTypeNode(value)) {
        if (!Node.isIndexSignatureDeclaration(value)) value.getParameters().forEach((parameter) => {
          const written = parameter.getTypeNode();
          if (written !== undefined) callbackOutputs(written);
        });
        const written = value.getReturnTypeNode();
        if (written !== undefined) node(written); else type(value.getReturnType());
      } else if (Node.isClassDeclaration(value) || Node.isClassExpression(value) || Node.isInterfaceDeclaration(value)) {
        value.getMembers().forEach(node);
        if (Node.isInterfaceDeclaration(value)) value.getExtends().forEach(node);
        else {
          const base = value.getExtends();
          if (base !== undefined) node(base);
          value.getImplements().forEach(node);
          value.getConstructors().flatMap((ctor) => ctor.getParameters()).filter((parameter) => parameter.isParameterProperty()).forEach((parameter) => {
            const written = parameter.getTypeNode();
            if (written !== undefined) node(written); else type(parameter.getType());
          });
        }
      } else if (Node.isTypeAliasDeclaration(value)) node(value.getTypeNodeOrThrow());
      else if (Node.isObjectLiteralExpression(value)) value.getProperties().forEach((property) => {
        if (Node.isPropertyAssignment(property)) node(property.getInitializerOrThrow());
        else if (Node.isShorthandPropertyAssignment(property)) {
          if (!symbol(property.getProject().getTypeChecker().getShorthandAssignmentValueSymbol(property), context)) missing(property);
        } else if (Node.isSpreadAssignment(property)) type(property.getExpression().getType());
        else node(property);
      });
      else if (Node.isSourceFile(value) || Node.isModuleDeclaration(value)) {
        const exports = Node.isSourceFile(value) ? value.getExportSymbols() : value.getSymbol()?.getExports();
        if (exports === undefined) { missing(value); return; }
        const body = Node.isSourceFile(value) ? value : value.getBody();
        const statements = Node.isSourceFile(body) || Node.isModuleBlock(body) ? body.getStatements() : [];
        const stars = statements.filter(Node.isExportDeclaration).filter((declaration) =>
          declaration.getNamedExports().length === 0 && declaration.getNamespaceExport() === undefined);
        const inherited = new Set<Symbol>();
        stars.forEach((declaration) => {
          const source = declaration.getModuleSpecifierSourceFile();
          if (source === undefined) { missing(declaration); return; }
          if (!declaration.isTypeOnly()) node(source);
          source.getExportSymbols().forEach((exported) => {
            const target = exported.isAlias() ? exported.getAliasedSymbol() : exported;
            if (target !== undefined) inherited.add(target);
          });
        });
        exports.forEach((exported) => {
          const declarations = exported.getDeclarations();
          if (declarations.some((declaration) =>
            Node.isExportSpecifier(declaration) && (declaration.isTypeOnly() || declaration.getExportDeclaration().isTypeOnly()))) return;
          const target = exported.isAlias() ? exported.getAliasedSymbol() : exported;
          if (target !== undefined && inherited.has(target) &&
            !declarations.some((declaration) => declaration.getSourceFile() === value.getSourceFile())) return;
          if (target !== undefined && (target.getFlags() & ts.SymbolFlags.Value) !== 0 && !symbol(target, context)) missing(value);
        });
      }
      else if (Node.isCallExpression(value)) {
        if (value.getProject().getTypeChecker().getResolvedSignature(value) === undefined) missing(value);
        type(value.getType());
      } else if (Node.isIdentifier(value) || Node.isImportSpecifier(value) || Node.isNamespaceImport(value) || Node.isImportClause(value)) {
        if (!symbol(value.getSymbol(), context)) { missing(value); type(value.getType()); }
      } else if (Node.isSetAccessorDeclaration(value) || Node.isConstructorDeclaration(value)) return;
      else {
        if (Node.isTypeNode(value)) missing(value);
        type(value.getType());
      }
    };
    const processType = (value: Type, context: Context): void => {
      const type = (value: Type) => enqueue({ kind: 'type', value, context });
      if (value.isUnion()) { value.getUnionTypes().forEach(type); return; }
      if (value.isIntersection()) { value.getIntersectionTypes().forEach(type); return; }
      if (value.isTuple()) { value.getTupleElements().forEach(type); return; }
      const element = value.getArrayElementType();
      if (element !== undefined) { type(element); return; }
      const alias = value.getAliasSymbol();
      const target = alias ?? value.getSymbol();
      const args = alias === undefined ? value.getTypeArguments() : value.getAliasTypeArguments();
      if (target !== undefined && symbol(target, context, args.map((value) => ({ kind: 'type', value, context })))) return;
      const signatures = [...value.getCallSignatures(), ...value.getConstructSignatures()];
      signatures.forEach((signature) => type(signature.getReturnType()));
      const properties = value.getProperties();
      properties.forEach((property) => { if (!symbol(property, context)) cause ??= 'unresolved package capability member'; });
      if (signatures.length === 0 && properties.length === 0 && !value.isTypeParameter()) cause ??= 'unresolved package capability type';
    };
    try {
      seeds.forEach((value) => enqueue({ kind: 'node', value, context: empty }));
      while (queue.length > 0 && !exposed) {
        const work = queue.shift()!;
        if (work.kind === 'node') processNode(work.value, work.context);
        else processType(work.value, work.context);
      }
    } catch { cause ??= 'unresolved package capability surface'; }
    return { kind: exposed ? 'exposed' : cause !== undefined ? 'incomplete' : 'unrelated', visited, cause };
  }
}
