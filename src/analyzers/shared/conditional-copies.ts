import { dirname, isAbsolute, resolve } from 'node:path';
import { CallExpression, ImportDeclaration, Node, SyntaxKind, Type } from 'ts-morph';
import { ResolvedPackages } from '../../engine/resolved-package';
import { SourceIndex } from './source-index';
import { PackageCapabilities } from './package-capabilities';
import { keyNames } from './writes';
import { outermostWrapper, unwrap } from './wrappers';

const withinRoot = (file: string, root: string): boolean => file.replace(/\\/g, '/').startsWith(root.replace(/\\/g, '/') + '/');

const allowedExports = new Set(['instanceToPlain', 'plainToInstance', 'classToPlain']);

export type CopyAuthority = 'conditional-copy' | 'unresolved-delegate' | 'other';
type DelegateAuthority = 'clear' | 'incomplete' | 'blocked';

const mergeDelegates = (causes: readonly DelegateAuthority[]): DelegateAuthority =>
  causes.includes('blocked') ? 'blocked' : causes.includes('incomplete') ? 'incomplete' : 'clear';

export class ConditionalCopies {
  private readonly packages = new ResolvedPackages();
  private readonly results = new Map<CallExpression, CopyAuthority>();
  private readonly capabilities = new Map<string, PackageCapabilities>();
  private readonly safeRoots = new Map<string, DelegateAuthority>();

  constructor(private readonly sources: SourceIndex) {}

  isConditionalRoot(call: CallExpression): boolean {
    return this.authorityOf(call) === 'conditional-copy';
  }

  authorityOf(call: CallExpression): CopyAuthority {
    const cached = this.results.get(call);
    if (cached !== undefined) return cached;
    const result = this.recognizes(call);
    this.results.set(call, result);
    return result;
  }

  private recognizes(call: CallExpression): CopyAuthority {
    const args = call.getArguments();
    if (args.length !== 1 || Node.isSpreadElement(args[0])) return 'other';
    const argument = unwrap(args[0]!);
    if (!Node.isIdentifier(argument) || !this.supportedInput(argument.getType())) return 'other';
    const expression = unwrap(call.getExpression());
    if (!Node.isIdentifier(expression)) return 'other';
    const declarations = expression.getSymbol()?.getDeclarations() ?? [];
    if (declarations.length !== 1 || !Node.isImportSpecifier(declarations[0])) return 'other';
    const imported = declarations[0];
    if (imported.getName() !== 'instanceToPlain') return 'other';
    const declaration = imported.getImportDeclaration();
    if (declaration.getModuleSpecifierValue() !== 'class-transformer') return 'other';
    const entry = this.packages.entryOf(declaration);
    if (entry?.name !== 'class-transformer' || entry.version !== '0.5.1' ||
      entry.main !== './cjs/index.js' || entry.typings !== './types/index.d.ts') return 'other';
    const symbol = expression.getSymbol();
    const exported = symbol?.isAlias() ? symbol.getAliasedSymbol() : undefined;
    const signature = call.getProject().getTypeChecker().getResolvedSignature(call)?.getDeclaration();
    if (signature === undefined || signature.getSourceFile().getFilePath() !== entry.entry ||
      !exported?.getDeclarations().includes(signature) || !Node.isFunctionDeclaration(signature) ||
      signature.getName() !== 'instanceToPlain') return 'other';
    const delegates = this.delegatesUnexposed(entry.root);
    return delegates === 'clear' ? 'conditional-copy' : delegates === 'incomplete' ? 'unresolved-delegate' : 'other';
  }

  private delegatesUnexposed(root: string): DelegateAuthority {
    const cached = this.safeRoots.get(root);
    if (cached !== undefined) return cached;
    let result: DelegateAuthority;
    try { result = this.inspectDelegates(root); } catch { result = 'blocked'; }
    this.safeRoots.set(root, result);
    return result;
  }

  private inspectDelegates(root: string): DelegateAuthority {
    const causes = this.sources.ofKind(SyntaxKind.ImportDeclaration).map((declaration) => this.safeImport(declaration, root));
    const exports = this.sources.ofKind(SyntaxKind.ExportDeclaration).some((declaration) => {
      const resolved = declaration.getModuleSpecifierSourceFile();
      if (resolved !== undefined) return withinRoot(resolved.getFilePath(), root);
      const module = declaration.getModuleSpecifierValue();
      return module === 'class-transformer' || module?.startsWith('class-transformer/');
    });
    const loaders = this.sources.ofKind(SyntaxKind.Identifier).filter((identifier) => identifier.getText() === 'require' && this.mayLoadModule(identifier, root)).every((identifier) => {
      const value = outermostWrapper(identifier);
      const call = value.getParent();
      return Node.isCallExpression(call) && call.getExpression() === value && this.unrelatedModuleLoad(call, root);
    }) && this.sources.ofKind(SyntaxKind.ElementAccessExpression).every((access) => {
      const key = access.getArgumentExpression()?.getType().getLiteralValue();
      const value = outermostWrapper(access);
      const parent = value.getParent();
      return key !== 'require' || !this.mayLoadModule(access, root) ||
        (Node.isCallExpression(parent) && parent.getExpression() === value && this.unrelatedModuleLoad(parent, root));
    }) && this.sources.ofKind(SyntaxKind.BindingElement).every((binding) => {
      const key = binding.getPropertyNameNode() ?? binding.getNameNode();
      const names = Node.isIdentifier(key) ? [key.getText()] : keyNames(Node.isComputedPropertyName(key) ? key.getExpression() : key);
      return !names.includes('require') || !this.mayLoadModule(binding.getNameNode(), root);
    }) && this.sources.ofKind(SyntaxKind.CallExpression).filter((call) => call.getExpression().getKind() === SyntaxKind.ImportKeyword)
      .every((call) => this.unrelatedModuleLoad(call, root));
    return exports || !loaders ? 'blocked' : mergeDelegates(causes);
  }

  private mayLoadModule(value: Node, root: string): boolean {
    const type = value.getType();
    if (type.isAny() || type.isUnknown()) return true;
    const returns = type.getCallSignatures().map((signature) => signature.getReturnType());
    const uncertain = (result: Type): boolean => result.isAny() || result.isUnknown() || result.isTypeParameter() ||
      result.isUnion() && result.getUnionTypes().some(uncertain);
    if (returns.some(uncertain)) return true;
    if (!returns.some((result) => result.isObject() || result.isUnion() && result.getUnionTypes().some((part) => part.isObject()))) return false;
    const capabilities = this.capabilities.get(root) ?? new PackageCapabilities(root);
    this.capabilities.set(root, capabilities);
    return capabilities.query(value, [value]).kind !== 'unrelated';
  }

  private unrelatedModuleLoad(call: CallExpression, root: string): boolean {
    const args = call.getArguments();
    const literal = args.length === 1 ? args[0]!.getType().getLiteralValue() : undefined;
    return typeof literal === 'string' && literal !== 'module' && literal !== 'node:module' && !this.packagePath(literal, call, root);
  }

  private supportedInput(type: Type, seen = new Set<Type>()): boolean {
    if (seen.has(type) || seen.size > 8) return false;
    if (type.isAny() || type.isUnknown() || type.getText() === 'object') return true;
    const next = new Set([...seen, type]);
    if (type.isTypeParameter()) {
      const bound = type.getConstraint();
      return bound === undefined || this.supportedInput(bound, next);
    }
    if (type.isUnion()) return type.getUnionTypes().every((part) => this.supportedInput(part, next));
    if (type.isIntersection()) return type.getIntersectionTypes().every((part) => this.supportedInput(part, next));
    if (!type.isObject() || type.isArray() || type.isReadonlyArray() || type.getCallSignatures().length > 0) return false;
    return (type.getSymbol()?.getDeclarations() ?? []).every((declaration) => this.sources.files.includes(declaration.getSourceFile()));
  }

  private packagePath(value: string, call: CallExpression, root: string): boolean {
    if (value === 'class-transformer' || value.startsWith('class-transformer/')) return true;
    if (!isAbsolute(value) && !value.startsWith('.')) return false;
    const path = resolve(dirname(call.getSourceFile().getFilePath()), value);
    return path.replace(/\\/g, '/') === root.replace(/\\/g, '/') || withinRoot(path, root);
  }

  private safeImport(declaration: ImportDeclaration, root: string): DelegateAuthority {
    const module = declaration.getModuleSpecifierValue();
    if (module === 'node:module' || module === 'module') return 'blocked';
    const resolved = declaration.getModuleSpecifierSourceFile();
    const entry = module === 'class-transformer' ? this.packages.entryOf(declaration) : undefined;
    if (entry?.root === root) {
      if (declaration.getNamespaceImport() !== undefined || declaration.getDefaultImport() !== undefined) return 'blocked';
      const safe = declaration.getNamedImports().every((imported) => {
        if (!allowedExports.has(imported.getName())) return false;
        const local = imported.getAliasNode() ?? imported.getNameNode();
        const symbol = local.getSymbol();
        if (symbol === undefined) return false;
        return this.sources.ofKind(SyntaxKind.Identifier).filter((identifier) => identifier.getSymbol() === symbol).every((identifier) => {
          if (identifier === local || identifier.getFirstAncestorByKind(SyntaxKind.ImportSpecifier) === imported) return true;
          const value = outermostWrapper(identifier);
          const parent = value.getParent();
          return Node.isCallExpression(parent) && parent.getExpression() === value;
        });
      });
      return safe ? 'clear' : 'blocked';
    }
    if (resolved !== undefined && withinRoot(resolved.getFilePath(), root)) return 'blocked';
    if (module === 'class-transformer' && entry === undefined) return 'blocked';
    if (module.startsWith('class-transformer/') && resolved === undefined) return 'blocked';
    const bindings = [declaration.getDefaultImport(), declaration.getNamespaceImport(),
      ...declaration.getNamedImports().map((named) => named.getAliasNode() ?? named.getNameNode()),
    ].filter((binding): binding is NonNullable<typeof binding> => binding !== undefined);
    const capabilities = this.capabilities.get(root) ?? new PackageCapabilities(root);
    this.capabilities.set(root, capabilities);
    return mergeDelegates(bindings.map((binding): DelegateAuthority => {
      const symbol = binding.getSymbol();
      const seeds: Node[] = [];
      for (const reference of this.sources.ofKind(SyntaxKind.Identifier).filter((reference) => reference.getSymbol() === symbol)) {
        if (reference.getFirstAncestorByKind(SyntaxKind.ImportDeclaration) === declaration ||
          reference.getAncestors().some((ancestor) => Node.isTypeReference(ancestor) || Node.isTypeQuery(ancestor) || Node.isImportTypeNode(ancestor))) continue;
        let value: Node = outermostWrapper(reference);
        seeds.push(value);
        let parent = value.getParent();
        while ((Node.isPropertyAccessExpression(parent) || Node.isElementAccessExpression(parent) || Node.isCallExpression(parent) || Node.isExpressionWithTypeArguments(parent)) && parent.getExpression() === value) {
          value = outermostWrapper(parent);
          seeds.push(value);
          parent = value.getParent();
        }
      }
      if (seeds.length === 0) return 'clear';
      const result = capabilities.query(binding, seeds);
      return result.kind === 'exposed' ? 'blocked' : result.kind === 'incomplete' ? 'incomplete' : 'clear';
    }));
  }
}
