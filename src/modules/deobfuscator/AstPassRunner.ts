/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import generateImport from '@babel/generator';
import * as parser from '@babel/parser';
import traverseImport from '@babel/traverse';
import type * as t from '@babel/types';

import {unwrapBabelDefault} from './astUtils.js';

const generate = unwrapBabelDefault<typeof generateImport>(generateImport);
const traverse = unwrapBabelDefault<typeof traverseImport>(traverseImport);

export interface AstPassResult {
  code: string;
  changed: boolean;
  iterations: number;
}

export interface AstPassOptions {
  maxIterations?: number;
  timeoutMs?: number;
}

export class AstPassRunner {
  static parseCode(code: string): t.File {
    return parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    }) as t.File;
  }

  static emitCode(ast: t.File): string {
    return generate(ast, {
      compact: false,
      comments: false,
      jsescOption: {minimal: true},
    }).code;
  }

  static reparse(ast: t.File): t.File {
    const code = AstPassRunner.emitCode(ast);
    return AstPassRunner.parseCode(code);
  }

  static run(
    code: string,
    transformFn: (ast: t.File) => {ast: t.File; changed: boolean},
    options?: AstPassOptions,
  ): AstPassResult {
    const maxIterations = options?.maxIterations ?? 20;
    const startTime = options?.timeoutMs ? Date.now() : 0;
    const timeoutMs = options?.timeoutMs ?? 0;

    let ast = AstPassRunner.parseCode(code);
    let totalChanged = false;
    let iterations = 0;

    for (let i = 0; i < maxIterations; i++) {
      if (timeoutMs > 0 && Date.now() - startTime > timeoutMs) {
        break;
      }

      const result = transformFn(ast);
      iterations++;

      if (!result.changed) {
        break;
      }

      totalChanged = true;
      ast = AstPassRunner.reparse(result.ast);
    }

    return {
      code: totalChanged ? AstPassRunner.emitCode(ast) : code,
      changed: totalChanged,
      iterations,
    };
  }
}

export {traverse, generate};
