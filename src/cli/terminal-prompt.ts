import { Interface, createInterface } from 'node:readline';
import { UsageError } from '../engine/errors';
import { Prompt } from './io';

type Lines = { readonly readline: Interface; readonly next: () => Promise<IteratorResult<string>>; readonly closed: () => boolean };

export type TerminalPrompt = { readonly prompt: Prompt; readonly close: () => void };

const STOPPED = 'init stopped before every suggestion was answered; nothing was written.';

const openLines = (input: NodeJS.ReadableStream, output: NodeJS.WritableStream): Lines => {
  const readline = createInterface({ input, output });
  const state = { closed: false };
  readline.once('close', () => {
    state.closed = true;
  });
  const lines = readline[Symbol.asyncIterator]();
  return { readline, next: () => lines.next(), closed: () => state.closed };
};

const ask = async (lines: Lines, output: NodeJS.WritableStream, question: string): Promise<string> => {
  if (lines.closed()) {
    output.write(question);
  } else {
    lines.readline.setPrompt(question);
    lines.readline.prompt();
  }
  const line = await lines.next();
  if (line.done === true) {
    output.write('\n');
    throw new UsageError(STOPPED);
  }
  return line.value;
};

export const terminalPrompt = (input: NodeJS.ReadableStream, output: NodeJS.WritableStream): TerminalPrompt => {
  const opened: { lines: Lines | undefined } = { lines: undefined };
  const lines = (): Lines => (opened.lines ??= openLines(input, output));
  return {
    prompt: (question) => ask(lines(), output, question),
    close: () => opened.lines?.readline.close(),
  };
};
