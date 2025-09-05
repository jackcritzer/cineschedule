// eslint.config.js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default [
  // Ignore build + deps
  { ignores: ['dist/**', 'node_modules/**'] },

  // Base JS recommendations
  js.configs.recommended,

  // TypeScript in /src
  ...tseslint.configs.recommended, // non-type-checked rules (fast, good default)
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        ...globals.node,  // Node.js globals
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off'
    },
  },
];