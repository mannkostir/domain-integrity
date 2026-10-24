export type Prompt = (question: string) => Promise<string>;

export type Io = {
  readonly cwd: string;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly prompt: Prompt;
  readonly isInteractive: boolean;
  readonly helpWidth: number;
};

export type Paths = { readonly tsconfig: string; readonly config: string; readonly projectRoot: string; readonly repositoryRoot: string };

export const DEFAULT_HELP_WIDTH = 80;

export const DEFAULT_TSCONFIG = 'tsconfig.json';

export const DEFAULT_CONFIG = 'domain.config.ts';
