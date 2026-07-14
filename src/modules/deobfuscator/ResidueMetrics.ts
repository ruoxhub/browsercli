/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import * as parser from '@babel/parser';
import traverseImport from '@babel/traverse';
import type {NodePath} from '@babel/traverse';

import {unwrapBabelDefault} from './astUtils.js';

const traverse = unwrapBabelDefault<typeof traverseImport>(traverseImport);

export interface ResidueMetricsResult {
  lineCount: number;
  splitPipeCount: number;
  loopSwitchCount: number;
  opcodeIfChainCount: number;
  dispatcherWrapperCount: number;
  hexIdentifierCount: number;
}

export class ResidueMetrics {
  static collect(text: string): ResidueMetricsResult {
    const lineCount = text.split('\n').length;
    const splitPipeCount = (text.match(/split\(\s*['"]\|['"]\s*\)/g) || [])
      .length;
    const hexIdentifierCount = (text.match(/\b_0x[a-f0-9]+\b/gi) || []).length;

    let loopSwitchCount = 0;
    let opcodeIfChainCount = 0;
    let dispatcherWrapperCount = 0;

    try {
      const ast = parser.parse(text, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });

      traverse(ast, {
        WhileStatement(path) {
          if (
            path.get('body').isBlockStatement() &&
            (path.get('body.body.0') as NodePath)?.isSwitchStatement()
          ) {
            loopSwitchCount++;
          }
        },
        ForStatement(path) {
          if (
            path.get('body').isBlockStatement() &&
            (path.get('body.body.0') as NodePath)?.isSwitchStatement()
          ) {
            loopSwitchCount++;
          }
        },
        IfStatement(path) {
          const test = path.node.test;
          if (
            test.type === 'BinaryExpression' &&
            (test.operator === '===' || test.operator === '==') &&
            (test.left.type === 'NumericLiteral' ||
              test.right.type === 'NumericLiteral')
          ) {
            if (path.node.alternate?.type === 'IfStatement') {
              opcodeIfChainCount++;
            }
          }
        },
        ObjectExpression(path) {
          const props = path.node.properties;
          if (props.length >= 3) {
            const fnProps = props.filter(
              p =>
                p.type === 'ObjectProperty' &&
                (p.value.type === 'FunctionExpression' ||
                  p.value.type === 'ArrowFunctionExpression'),
            );
            if (fnProps.length >= props.length * 0.6) {
              dispatcherWrapperCount++;
            }
          }
        },
      });
    } catch {
      // parse failure — regex-only metrics still valid
    }

    return {
      lineCount,
      splitPipeCount,
      loopSwitchCount,
      opcodeIfChainCount,
      dispatcherWrapperCount,
      hexIdentifierCount,
    };
  }

  static compare(
    ours: ResidueMetricsResult,
    reference: ResidueMetricsResult,
  ): {gaps: string[]; status: 'pass' | 'fail'} {
    const gaps: string[] = [];

    if (ours.splitPipeCount > reference.splitPipeCount) {
      gaps.push(
        `splitPipe: ${ours.splitPipeCount} > ${reference.splitPipeCount}`,
      );
    }
    if (ours.loopSwitchCount > reference.loopSwitchCount) {
      gaps.push(
        `loopSwitch: ${ours.loopSwitchCount} > ${reference.loopSwitchCount}`,
      );
    }
    if (ours.opcodeIfChainCount > reference.opcodeIfChainCount) {
      gaps.push(
        `opcodeIfChain: ${ours.opcodeIfChainCount} > ${reference.opcodeIfChainCount}`,
      );
    }
    if (ours.dispatcherWrapperCount > reference.dispatcherWrapperCount) {
      gaps.push(
        `dispatcherWrapper: ${ours.dispatcherWrapperCount} > ${reference.dispatcherWrapperCount}`,
      );
    }
    if (ours.hexIdentifierCount > reference.hexIdentifierCount) {
      gaps.push(
        `hexIdentifier: ${ours.hexIdentifierCount} > ${reference.hexIdentifierCount}`,
      );
    }

    return {gaps, status: gaps.length === 0 ? 'pass' : 'fail'};
  }
}
