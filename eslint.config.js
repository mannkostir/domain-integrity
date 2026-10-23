import tseslint from 'typescript-eslint';

const tsMorph = { name: 'ts-morph', message: 'Keep ts-morph out of the config helpers and the pure checks.' };

export default tseslint.config(
  { ignores: ['dist', 'test/fixtures'] },
  ...tseslint.configs.recommended,
  { rules: { '@typescript-eslint/ban-ts-comment': ['error', { 'ts-expect-error': false }] } },
  {
    files: ['src/index.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [tsMorph],
          patterns: [{ group: ['./*', '!./config'], message: 'The public entry point exports the config helpers only.' }],
        },
      ],
    },
  },
  {
    files: ['src/config/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [tsMorph],
          patterns: [{ group: ['../*'], message: 'The config helpers stay independent of the rest of the package.' }],
        },
      ],
    },
  },
  {
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/analyzers', '**/analyzers/**', '**/cli', '**/cli/**', '**/report', '**/report/**'], message: 'The engine knows nothing about analyzers, the CLI or reports.' },
          ],
        },
      ],
    },
  },
  {
    files: ['src/analyzers/lifecycle/checks/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { paths: [tsMorph] }] },
  },
  {
    files: ['src/rules/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { paths: [tsMorph] }] },
  },
);
