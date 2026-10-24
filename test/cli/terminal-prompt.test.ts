import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { UsageError } from '../../src/engine/errors';
import { terminalPrompt } from '../../src/cli/terminal-prompt';

const endedInput = (text: string): PassThrough => {
  const input = new PassThrough();
  input.end(text);
  return input;
};

const collected = (stream: PassThrough): (() => string) => {
  const chunks: string[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));
  return () => chunks.join('');
};

describe('terminalPrompt', () => {
  it('writes the question to the output', async () => {
    const output = new PassThrough();
    const written = collected(output);
    const terminal = terminalPrompt(endedInput('y\n'), output);

    await terminal.prompt('Declare? ');
    terminal.close();

    expect(written()).toContain('Declare? ');
  });

  it('answers with each line in order when several arrive at once', async () => {
    const terminal = terminalPrompt(endedInput('e\nclosed\n'), new PassThrough());

    const answers = [await terminal.prompt('first? '), await terminal.prompt('second? ')];
    terminal.close();

    expect(answers).toEqual(['e', 'closed']);
  });

  it('rejects with a usage error when the input ends before an answer', async () => {
    const terminal = terminalPrompt(endedInput(''), new PassThrough());

    const answer = terminal.prompt('Declare? ');

    await expect(answer).rejects.toBeInstanceOf(UsageError);
  });

  it('says that nothing was written when the input ends before an answer', async () => {
    const terminal = terminalPrompt(endedInput('e\n'), new PassThrough());
    await terminal.prompt('Declare? ');

    const answer = terminal.prompt('Values? ');

    await expect(answer).rejects.toThrow('init stopped before every suggestion was answered; nothing was written.');
  });
});
