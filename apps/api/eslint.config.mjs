import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'src/generated/prisma/**'] },
  {
    files: ['**/*.ts', '**/*.mjs'],
    ...js.configs.recommended,
    languageOptions: {
      globals: Object.fromEntries(['process', 'Buffer', 'URL', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'fetch', 'AbortSignal'].map((key) => [key, 'readonly'])),
    },
  },
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: ['src/**/*.ts'] })),
  {
    files: ['src/**/*.ts'],
    languageOptions: { parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': 'error',
    },
  },
];
