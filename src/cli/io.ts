export type Prompt = (question: string) => Promise<boolean>;

export type Io = {
  readonly cwd: string;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly prompt: Prompt;
  readonly isInteractive: boolean;
};

export type Paths = { readonly tsconfig: string; readonly config: string; readonly root: string };
