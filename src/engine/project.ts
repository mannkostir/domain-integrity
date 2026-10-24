import { Project, SourceFile, ts } from 'ts-morph';
import { ConfigError, ProjectError } from './errors';
import { shownPath } from './path';
import { ShowPath, readReferencesFromDisk, referencedTsconfigs } from './references';

const isProjectSource = (file: SourceFile): boolean => !file.isDeclarationFile() && !file.isInNodeModules();

export const loadedSourceFiles = (count: number): string => `Loaded ${count} ${count === 1 ? 'source file' : 'source files'}.`;

const includesClause = (tsconfig: string, references: readonly string[]): string =>
  references.length === 0 ? `${tsconfig} includes` : `${tsconfig} and the tsconfigs it references include`;

const noSourcesSentence = (includes: string, config: string | undefined): string =>
  config === undefined ? `${includes} no source files.` : `${includes} no source files other than ${config}.`;

const emptyProgramMessage = (tsconfig: string, references: readonly string[], config: string | undefined): string =>
  [
    loadedSourceFiles(0),
    noSourcesSentence(includesClause(tsconfig, references), config),
    ...(references.length === 0 ? ['Pass -p with a tsconfig that includes your code, or add "references" to the tsconfigs that do.'] : []),
  ].join('\n');

const loadFailure = (tsconfig: string, error: unknown): ProjectError =>
  new ProjectError(`Cannot load ${tsconfig}: ${error instanceof Error ? error.message : String(error)}`);

const TYPESCRIPT_EXTENSIONS: readonly string[] = [ts.Extension.Ts, ts.Extension.Tsx, ts.Extension.Mts, ts.Extension.Cts];

const JAVASCRIPT_EXTENSIONS: readonly string[] = [ts.Extension.Js, ts.Extension.Jsx, ts.Extension.Mjs, ts.Extension.Cjs];

const allowsJavaScript = (options: ts.CompilerOptions): boolean => options.allowJs ?? options.checkJs ?? false;

const supportedExtensions = (options: ts.CompilerOptions): readonly string[] =>
  allowsJavaScript(options) ? [...TYPESCRIPT_EXTENSIONS, ...JAVASCRIPT_EXTENSIONS] : TYPESCRIPT_EXTENSIONS;

const hasSupportedExtension = (path: string, extensions: readonly string[]): boolean =>
  extensions.some((extension) => path.endsWith(extension));

const addSupportedFilesOf = (project: Project, reference: string): void => {
  const extensions = supportedExtensions(project.getCompilerOptions());
  project
    .addSourceFilesFromTsConfig(reference)
    .filter((file) => !hasSupportedExtension(file.getFilePath(), extensions))
    .forEach((file) => project.removeSourceFile(file));
};

const projectFrom = (tsconfigPath: string, references: readonly string[], shown: ShowPath): Project => {
  try {
    const project = new Project({ tsConfigFilePath: tsconfigPath });
    references.forEach((reference) => addSupportedFilesOf(project, reference));
    project.resolveSourceFileDependencies();
    return project;
  } catch (error) {
    throw loadFailure(shown(tsconfigPath), error);
  }
};

export const analysedSourceFiles = (project: Project, excluded?: SourceFile): SourceFile[] =>
  project.getSourceFiles().filter((file) => file !== excluded && isProjectSource(file));

export const loadProject = (tsconfigPath: string, configPath: string, cwd: string): Project => {
  const shown: ShowPath = (path) => shownPath(cwd, path);
  const references = referencedTsconfigs(tsconfigPath, readReferencesFromDisk, shown);
  const project = projectFrom(tsconfigPath, references, shown);
  const configFile = project.getSourceFile(configPath);
  if (analysedSourceFiles(project, configFile).length === 0) {
    throw new ProjectError(emptyProgramMessage(shown(tsconfigPath), references, configFile && shown(configFile.getFilePath())));
  }
  return project;
};

export const configSourceFile = (project: Project, configPath: string, cwd: string): SourceFile => {
  const loaded = project.getSourceFile(configPath);
  if (loaded) return loaded;
  if (!project.getFileSystem().fileExistsSync(configPath)) {
    throw new ConfigError(
      `${shownPath(cwd, configPath)} not found. Run "domain-integrity init" to create it, or pass -c with the path to your config file.`,
    );
  }
  return project.addSourceFileAtPath(configPath);
};
