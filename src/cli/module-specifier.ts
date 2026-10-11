import { ModuleResolutionKind, Project, SourceFile } from 'ts-morph';

export type ModuleSpecifiers = (from: SourceFile, target: string) => string;

const RUNTIME_EXTENSION_RESOLUTIONS: readonly ModuleResolutionKind[] = [
  ModuleResolutionKind.Node16,
  ModuleResolutionKind.NodeNext,
];

const SOURCE_EXTENSION = /(?:\.d)?\.([mc]?)[jt]sx?$/;

const withRuntimeExtension = (path: string): string =>
  path.replace(SOURCE_EXTENSION, (_extension, kind: string) => `.${kind}js`);

const asRelativeSpecifier = (path: string): string => (path.startsWith('../') ? path : `./${path}`);

const runtimeSpecifier: ModuleSpecifiers = (from, target) =>
  asRelativeSpecifier(withRuntimeExtension(from.getRelativePathTo(target)));

const extensionlessSpecifier: ModuleSpecifiers = (from, target) => from.getRelativePathAsModuleSpecifierTo(target);

export const moduleSpecifiers = (project: Project): ModuleSpecifiers =>
  RUNTIME_EXTENSION_RESOLUTIONS.includes(project.getProgram().getEmitModuleResolutionKind())
    ? runtimeSpecifier
    : extensionlessSpecifier;
