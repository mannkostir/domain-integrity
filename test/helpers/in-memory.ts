import { readFileSync } from 'node:fs';
import { CompilerOptions, ModuleKind, ModuleResolutionKind, Project, ScriptTarget } from 'ts-morph';

const HELPERS_SOURCE = readFileSync(new URL('../../src/config/define.ts', import.meta.url), 'utf8');

export const AGGREGATE_ROOT = `
export abstract class AggregateRoot<P extends object = object> {
  protected props: P;
  private events: object[] = [];

  constructor(props: P) {
    this.props = props;
  }

  protected addEvent(event: object): void {
    this.events.push(event);
  }
}
`;

export const inMemoryProject = (
  files: Readonly<Record<string, string>>,
  compilerOptionOverrides: CompilerOptions = {},
): Project => {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      strict: true,
      target: ScriptTarget.ES2022,
      module: ModuleKind.ESNext,
      moduleResolution: ModuleResolutionKind.Bundler,
      paths: { 'domain-integrity': ['/lib/domain-integrity.ts'] },
      ...compilerOptionOverrides,
    },
  });
  project.createSourceFile('/lib/domain-integrity.ts', HELPERS_SOURCE);
  Object.entries(files).forEach(([path, text]) => project.createSourceFile(path, text));
  return project;
};
