export type Prompt = (question: string) => Promise<string>;

export type Io = {
  readonly cwd: string;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly prompt: Prompt;
  readonly isInteractive: boolean;
};

export type Paths = { readonly tsconfig: string; readonly config: string; readonly projectRoot: string; readonly repositoryRoot: string };

export const DEFAULT_TSCONFIG = 'tsconfig.json';

export const DEFAULT_CONFIG = 'domain.config.ts';
