import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'test/fixtures'] },
  ...tseslint.configs.recommended,
  { rules: { '@typescript-eslint/ban-ts-comment': ['error', { 'ts-expect-error': false }] } },
);
