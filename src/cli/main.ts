#!/usr/bin/env node
import { DEFAULT_HELP_WIDTH, Io } from './io';
import { run } from './run';
import { terminalPrompt } from './terminal-prompt';

const terminal = terminalPrompt(process.stdin, process.stdout);

const io: Io = {
  cwd: process.cwd(),
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  prompt: terminal.prompt,
  isInteractive: Boolean(process.stdin.isTTY),
  helpWidth: process.stdout.isTTY ? (process.stdout.columns ?? DEFAULT_HELP_WIDTH) : DEFAULT_HELP_WIDTH,
};

try {
  process.exitCode = await run(process.argv.slice(2), io);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? String(error)) : String(error)}\n`);
  process.exitCode = 2;
} finally {
  terminal.close();
}
