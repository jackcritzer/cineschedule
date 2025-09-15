// eslint.config.js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import jsdoc from 'eslint-plugin-jsdoc';

export default [
  // Ignore build + deps
  { ignores: ['dist/**', 'node_modules/**'] },

  // Base JS recommendations
  js.configs.recommended,

  // TypeScript (fast, non-type-checked rules)
  ...tseslint.configs.recommended,

  // Project rules for TS files
  {
    files: ['src/**/*.{ts,tsx}'],
    // (tseslint.configs.recommended already sets the parser)
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    plugins: {
      jsdoc, // <— add the plugin
    },
    settings: {
      // Let JSDoc assume TypeScript types so it doesn't require @type
      jsdoc: { 
        mode: 'typescript',
        structuredTags: {
          route:  { name: false, type: false },
          summary:{ name: false, type: false },
          auth:   { name: false, type: false },
          query:  { name: false, type: false },
          body:   { name: false, type: false },    // <<< allow @body
          params: { name: false, type: false },    // <<< allow @params
          returns:{ name: false, type: false },
          errors: { name: false, type: false },
        },
      },
    },
    rules: {
      // Your existing override
      '@typescript-eslint/no-explicit-any': 'off',

      // JSDoc rules tuned for your route headers
      'jsdoc/require-param-type': 'off',
      'jsdoc/require-returns-type': 'off',
      'jsdoc/check-tag-names': ['error', {
        definedTags: ['route', 'summary', 'auth', 'query', 'body', 'params', 'returns', 'errors'],
      }],
      'jsdoc/require-jsdoc': ['warn', {
        publicOnly: true,
        require: {
          FunctionDeclaration: true,
          MethodDefinition: true,
          ClassDeclaration: false,
          ArrowFunctionExpression: false, // set true if you want arrow handlers documented too
        },
        contexts: [
          // nudge docs for exported handlers in routes
          'ExportNamedDeclaration > FunctionDeclaration',
          'ExportNamedDeclaration > VariableDeclaration > VariableDeclarator[init.type="ArrowFunctionExpression"]'
        ],
      }],
    },
  },

  // (Optional) Looser rules for config/scripts outside src
  {
    files: ['**/*.config.{js,cjs,mjs}', 'scripts/**/*.{js,ts}'],
    rules: {
      '@typescript-eslint/no-var-requires': 'off',
      'jsdoc/require-jsdoc': 'off',
    },
  },
];