/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 智能分析器
 *
 * 整合关键流量过滤 + 模式检测，输出适合 LLM 阅读的结构化摘要。
 * 输入是已经被采集到内存中的 NetworkRequest / Response / ConsoleMessage / Exception。
 */

import {logger} from '../../utils/logger.js';

import type {
  AnalyzerConsoleMessage,
  AnalyzerExceptionInfo,
  AnalyzerNetworkRequest,
  AnalyzerNetworkResponse,
  AntiDebugPattern,
  EncryptionPattern,
  SignaturePattern,
  TokenPattern,
} from './IntelligentAnalyzer.types.js';
import {
  detectAntiDebugPatterns,
  detectEncryptionPatterns,
  detectSignaturePatterns,
  detectTokenPatterns,
  extractKeyFunctions,
  extractSuspiciousAPIs,
  filterCriticalLogs,
  filterCriticalRequests,
  filterCriticalResponses,
} from './PatternDetector.js';

export {
  type AntiDebugPattern,
  type EncryptionPattern,
  type SignaturePattern,
  type TokenPattern,
} from './IntelligentAnalyzer.types.js';

export interface AnalysisResult {
  criticalRequests: AnalyzerNetworkRequest[];
  criticalResponses: AnalyzerNetworkResponse[];
  criticalLogs: AnalyzerConsoleMessage[];
  exceptions: AnalyzerExceptionInfo[];
  patterns: {
    encryption?: EncryptionPattern[];
    signature?: SignaturePattern[];
    token?: TokenPattern[];
    antiDebug?: AntiDebugPattern[];
  };
  summary: {
    totalRequests: number;
    filteredRequests: number;
    totalLogs: number;
    filteredLogs: number;
    suspiciousAPIs: string[];
    keyFunctions: string[];
  };
}

function formatEvidence(evidence: unknown): string {
  if (Array.isArray(evidence)) {
    return evidence.join(', ');
  }
  return evidence ? String(evidence) : '';
}

export class IntelligentAnalyzer {
  analyze(data: {
    requests: AnalyzerNetworkRequest[];
    responses: AnalyzerNetworkResponse[];
    logs: AnalyzerConsoleMessage[];
    exceptions: AnalyzerExceptionInfo[];
  }): AnalysisResult {
    logger.info('Starting intelligent analysis...', {
      requests: data.requests.length,
      responses: data.responses.length,
      logs: data.logs.length,
      exceptions: data.exceptions.length,
    });

    const criticalRequests = filterCriticalRequests(data.requests);
    const criticalResponses = filterCriticalResponses(data.responses);
    const criticalLogs = filterCriticalLogs(data.logs);

    const patterns = {
      encryption: detectEncryptionPatterns(data.requests, data.logs),
      signature: detectSignaturePatterns(data.requests, data.logs),
      token: detectTokenPatterns(data.requests, data.logs),
      antiDebug: detectAntiDebugPatterns(data.logs),
    };

    const suspiciousAPIs = extractSuspiciousAPIs(criticalRequests);
    const keyFunctions = extractKeyFunctions(criticalLogs);

    const result: AnalysisResult = {
      criticalRequests,
      criticalResponses,
      criticalLogs,
      exceptions: data.exceptions,
      patterns,
      summary: {
        totalRequests: data.requests.length,
        filteredRequests: criticalRequests.length,
        totalLogs: data.logs.length,
        filteredLogs: criticalLogs.length,
        suspiciousAPIs,
        keyFunctions,
      },
    };

    logger.success('Analysis completed', {
      criticalRequests: criticalRequests.length,
      criticalLogs: criticalLogs.length,
      patterns: Object.keys(patterns).length,
    });

    return result;
  }

  aggregateSimilarRequests(
    requests: AnalyzerNetworkRequest[],
  ): Map<string, AnalyzerNetworkRequest[]> {
    const groups = new Map<string, AnalyzerNetworkRequest[]>();

    for (const req of requests) {
      try {
        const url = new URL(req.url);
        const baseUrl = `${url.origin}${url.pathname}`;

        if (!groups.has(baseUrl)) {
          groups.set(baseUrl, []);
        }
        groups.get(baseUrl)!.push(req);
      } catch {
        /* URL parse failed — skip non-standard URLs during request grouping */
      }
    }

    return groups;
  }

  generateAIFriendlySummary(result: AnalysisResult): string {
    const lines: string[] = [];

    lines.push('=== Analysis Summary ===');
    lines.push('');

    lines.push(`Statistics:`);
    lines.push(
      `  - Requests: ${result.summary.totalRequests} -> Filtered: ${result.summary.filteredRequests}`,
    );
    lines.push(
      `  - Logs: ${result.summary.totalLogs} -> Filtered: ${result.summary.filteredLogs}`,
    );
    lines.push(`  - Exceptions: ${result.exceptions.length}`);
    lines.push('');

    if (result.summary.suspiciousAPIs.length > 0) {
      lines.push(`Suspicious APIs (${result.summary.suspiciousAPIs.length}):`);
      result.summary.suspiciousAPIs.slice(0, 10).forEach(api => {
        lines.push(`  - ${api}`);
      });
      lines.push('');
    }

    if (result.patterns.encryption && result.patterns.encryption.length > 0) {
      lines.push(`Encryption Patterns (${result.patterns.encryption.length}):`);
      result.patterns.encryption.slice(0, 5).forEach(pattern => {
        const evidence = formatEvidence(pattern.evidence);
        lines.push(
          `  - ${pattern.type} (confidence: ${(pattern.confidence * 100).toFixed(0)}%)`,
        );
        lines.push(`    location: ${pattern.location}`);
        lines.push(`    evidence: ${evidence}`);
      });
      lines.push('');
    }

    if (result.patterns.signature && result.patterns.signature.length > 0) {
      lines.push(`Signature Patterns (${result.patterns.signature.length}):`);
      result.patterns.signature.slice(0, 5).forEach(pattern => {
        const parameters = formatEvidence(pattern.parameters);
        lines.push(`  - ${pattern.type}`);
        lines.push(`    parameters: ${parameters}`);
      });
      lines.push('');
    }

    if (result.patterns.antiDebug && result.patterns.antiDebug.length > 0) {
      lines.push(`Anti-Debug Patterns (${result.patterns.antiDebug.length}):`);
      result.patterns.antiDebug.slice(0, 3).forEach(pattern => {
        lines.push(`  - ${pattern.type}`);
      });
      lines.push('');
    }

    if (result.summary.keyFunctions.length > 0) {
      lines.push(`Key Functions (${result.summary.keyFunctions.length}):`);
      lines.push(`  ${result.summary.keyFunctions.slice(0, 15).join(', ')}`);
      lines.push('');
    }

    lines.push('=== Analysis Summary ===');

    return lines.join('\n');
  }
}
