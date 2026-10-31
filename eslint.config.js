import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', 'coverage/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/api/src/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['@rag/ui/**', '../../ui/**', '../../../apps/ui/**'], message: 'API code may not import UI implementation.' }] }] },
  },
  {
    files: ['apps/ui/src/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['@rag/api/**', '../../api/**', '../../../apps/api/**'], message: 'UI code may not import API implementation.' }] }] },
  },
  {
    files: ['packages/domain/src/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['fastify', '@fastify/**', 'pg', 'react', 'react-dom', 'node:**'], message: 'Domain code must remain runtime-neutral.' }] }] },
  },
);
