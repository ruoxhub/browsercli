/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import js from '@eslint/js';
import stylisticPlugin from '@stylistic/eslint-plugin';
import {defineConfig, globalIgnores} from 'eslint/config';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import localPlugin from './scripts/eslint_rules/local-plugin.js';

export default defineConfig([
  globalIgnores([
    '**/node_modules',
    '**/build/',
    // Non-source / generated artifacts — not part of the linted codebase.
    '**/scratch/**',
    '**/example/Obfuscation/**',
    '**/artifacts/**',
    'browsercli/**',
    'scripts/cases/**',
    'test-load.mjs',
  ]),
  importPlugin.flatConfigs.typescript,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',

      globals: {
        ...globals.node,
      },

      parserOptions: {
        projectService: {
          // Files outside the main tsconfig include that still need
          // type-aware linting. The default-project cap is raised because
          // we have more than 8 such files (build scripts, legacy test
          // *.js, root config files).
          allowDefaultProject: [
            '.prettierrc.cjs',
            'puppeteer.config.cjs',
            'eslint.config.mjs',
            'rollup.config.mjs',
            'vitest.config.ts',
            'vite.web-ui.config.ts',
            'scripts/eslint_rules/local-plugin.js',
            'scripts/eslint_rules/check-license-rule.js',
            'scripts/sed.ts',
            'scripts/prepare.ts',
            'scripts/post-build.ts',
            'scripts/generate-tools-index.ts',
            'scripts/generate-docs.ts',
            'tests/setup.js',
            'tests/new-tools.test.js',
            'tests/daemon/start-daemon-helper.js',
            'tests/unit/scripts/debugger-lab-server.test.js',
          ],
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 50,
        },
      },

      parser: tseslint.parser,
    },

    plugins: {
      js,
      '@local': localPlugin,
      '@typescript-eslint': tseslint.plugin,
      '@stylistic': stylisticPlugin,
    },

    settings: {
      'import/resolver': {
        typescript: true,
      },
    },

    extends: ['js/recommended'],
  },
  tseslint.configs.recommended,
  tseslint.configs.stylistic,
  {
    name: 'TypeScript rules',
    rules: {
      '@local/check-license': 'error',

      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': [
        'error',
        {
          ignoreRestArgs: true,
        },
      ],
      // This optimizes the dependency tracking for type-only files.
      '@typescript-eslint/consistent-type-imports': 'error',
      // So type-only exports get elided.
      '@typescript-eslint/consistent-type-exports': 'error',
      // Prefer interfaces over types for shape like.
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/array-type': [
        'error',
        {
          default: 'array-simple',
        },
      ],
      '@typescript-eslint/no-floating-promises': 'error',

      'import/order': [
        'error',
        {
          'newlines-between': 'always',

          alphabetize: {
            order: 'asc',
            caseInsensitive: true,
          },
        },
      ],

      'import/no-cycle': [
        'error',
        {
          maxDepth: Infinity,
        },
      ],

      'import/enforce-node-protocol-usage': ['error', 'always'],

      '@stylistic/function-call-spacing': 'error',
      '@stylistic/semi': 'error',

      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '.*chrome-devtools-frontend/(?!mcp/mcp.js$).*',
              message:
                'Import only the devtools-frontend code exported via node_modules/chrome-devtools-frontend/mcp/mcp.js',
            },
          ],
        },
      ],
    },
  },
  {
    name: 'Tests',
    files: ['**/*.test.ts'],
    rules: {
      // With the Node.js test runner, `describe` and `it` are technically
      // promises, but we don't need to await them.
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
]);
