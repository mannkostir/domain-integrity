import { basename, dirname, resolve } from 'node:path';
import { ImportDeclaration, Project, SourceFile, ts } from 'ts-morph';

export type ResolvedPackage = {
  readonly name: string;
  readonly version: string;
  readonly root: string;
  readonly entry: string;
  readonly main: string;
  readonly typings: string;
};

type Manifest = { readonly name: string; readonly version: string; readonly main: string; readonly typings: string };

const manifestOf = (text: string): Manifest | undefined => {
  const value: unknown = JSON.parse(text);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.exports !== undefined || record.typesVersions !== undefined) return undefined;
  const { name, version, main } = record;
  const typings = record.typings ?? record.types;
  return typeof name === 'string' && name.length > 0 && typeof version === 'string' && version.length > 0 &&
    typeof main === 'string' && main.length > 0 && typeof typings === 'string' && typings.length > 0 &&
    (record.typings === undefined || record.types === undefined || record.typings === record.types)
    ? { name, version, main, typings } : undefined;
};

const matchesPath = (pattern: string, name: string): boolean => {
  const star = pattern.indexOf('*');
  return star < 0 ? pattern === name : name.startsWith(pattern.slice(0, star)) && name.endsWith(pattern.slice(star + 1));
};

const packageRoot = (root: string, name: string): boolean => {
  const parts = name.split('/');
  return parts.length === 1
    ? basename(root) === name && basename(dirname(root)) === 'node_modules'
    : parts.length === 2 && parts[0]!.startsWith('@') && basename(root) === parts[1] &&
      basename(dirname(root)) === parts[0] && basename(dirname(dirname(root))) === 'node_modules';
};

const readFile = (project: Project, path: string): string | undefined => {
  const loaded = project.getSourceFile(path);
  if (loaded !== undefined) return loaded.getFullText();
  try {
    return project.getFileSystem().readFileSync(path);
  } catch {
    return undefined;
  }
};

const hostFor = (project: Project): ts.ModuleResolutionHost => ({
  fileExists: (path) => project.getSourceFile(path) !== undefined || project.getFileSystem().fileExistsSync(path),
  readFile: (path) => readFile(project, path),
  directoryExists: (path) => project.getFileSystem().directoryExistsSync(path) ||
    project.getSourceFiles().some((file) => file.getFilePath().startsWith(path.replace(/\\/g, '/') + '/')),
  getCurrentDirectory: () => project.getFileSystem().getCurrentDirectory(),
});

export class ResolvedPackages {
  private readonly results = new Map<ImportDeclaration, ResolvedPackage | undefined>();

  entryOf(declaration: ImportDeclaration): ResolvedPackage | undefined {
    if (this.results.has(declaration)) return this.results.get(declaration);
    const entry = this.resolve(declaration);
    this.results.set(declaration, entry);
    return entry;
  }

  private resolve(declaration: ImportDeclaration): ResolvedPackage | undefined {
    const name = declaration.getModuleSpecifierValue();
    if (!/^(?:@[^/]+\/)?[^./][^/]*$/.test(name)) return undefined;
    const project = declaration.getProject();
    const options = project.getCompilerOptions();
    if (Object.keys(options.paths ?? {}).some((pattern) => matchesPath(pattern, name))) return undefined;
    let entry: SourceFile | undefined;
    try {
      entry = declaration.getModuleSpecifierSourceFile();
    } catch {
      return undefined;
    }
    if (entry === undefined || !entry.isDeclarationFile() || !entry.isInNodeModules()) return undefined;
    let resolved: ts.ResolvedModuleFull | undefined;
    try {
      resolved = ts.resolveModuleName(name, declaration.getSourceFile().getFilePath(), options, hostFor(project)).resolvedModule;
    } catch {
      return undefined;
    }
    if (resolved?.isExternalLibraryImport !== true || resolved.packageId?.name !== name ||
      resolve(resolved.resolvedFileName) !== resolve(entry.getFilePath())) return undefined;
    let directory = dirname(entry.getFilePath());
    while (dirname(directory) !== directory) {
      const text = readFile(project, resolve(directory, 'package.json'));
      if (text !== undefined) {
        if (!packageRoot(directory, name)) return undefined;
        try {
          const manifest = manifestOf(text);
          if (manifest === undefined || manifest.name !== name || manifest.version !== resolved.packageId.version ||
            resolve(directory, manifest.typings) !== resolve(entry.getFilePath())) return undefined;
          return { ...manifest, root: directory, entry: entry.getFilePath() };
        } catch {
          return undefined;
        }
      }
      directory = dirname(directory);
    }
    return undefined;
  }
}
