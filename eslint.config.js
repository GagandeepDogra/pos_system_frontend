import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', '**/sw-template.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/pos-web/src/**/*.{ts,tsx}'],
    plugins: { react },
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    settings: { react: { version: '19' } },
    rules: {
      // All staff-facing text comes from en.json / hi.json; a literal string in JSX fails the build.
      'react/jsx-no-literals': ['error', { noStrings: true, ignoreProps: true, allowedStrings: ['✓', '✕', '⌫', '·', '/'] }],
      'no-restricted-syntax': ['error', { selector: 'TSEnumDeclaration', message: 'Define enums in packages/shared.' }],
    },
  },
  {
    files: ['apps/pos-web/src/**/*.test.{ts,tsx}'],
    rules: { 'react/jsx-no-literals': 'off' },
  },
);
