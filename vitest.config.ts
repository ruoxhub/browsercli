/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'pure',
          include: [
            'tests/unit/utils/**/*.test.ts',
            'tests/unit/modules/**/*.test.ts',
            'tests/unit/functions/**/*.test.ts',
            'tests/property/**/*.test.ts',
          ],
        },
      },
      {
        test: {
          name: 'browser',
          include: [
            'tests/unit/browser/**/*.test.ts',
            'tests/unit/tools/**/*.test.ts',
            'tests/unit/worker/**/*.test.ts',
            'tests/unit/services/**/*.test.ts',
          ],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
});
