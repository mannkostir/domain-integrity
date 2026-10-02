#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { Io } from './io';
import { run } from './run';

const prompt = async (question: string): Promise<boolean> => {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await readline.question(question);
  readline.close();
  return !/^n/i.test(answer.trim());
};

const io: Io = {
  cwd: process.cwd(),
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  prompt,
  isInteractive: Boolean(process.stdin.isTTY),
};

try {
  process.exitCode = await run(process.argv.slice(2), io);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? String(error)) : String(error)}\n`);
  process.exitCode = 2;
}
