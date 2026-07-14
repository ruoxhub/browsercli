/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  buildBodyAnalysis,
  classifyBodyKind,
  dedupeHeaders,
  dedupeKeyValue,
  describeRuntimeEvent,
  describeSink,
  describeStep,
  determineSuspicion,
  type ExportSuspicion,
  isSensitiveHeader,
  joinOrFallback,
  joinOrNone,
  maskValue,
  normalizeHeaderName,
  parseUrlDetails,
  splitBodySegments,
  uniqueStrings,
  type WasmExportUsageSummary,
} from './WasmAnalysisUtils.js';
import type {
  WasmBoundaryChain,
  WasmBoundaryStep,
  WasmHeaderEntry,
  WasmKeyValuePreview,
  WasmModuleRecord,
  WasmRuntimeEvent,
  WasmSignatureDiffFieldChange,
  WasmSignatureDiffResult,
} from './WasmTypes.js';

export class WasmRuntimeInspector {
  summarizeExports(
    module: WasmModuleRecord,
    events: WasmRuntimeEvent[],
  ): WasmExportUsageSummary[] {
    const relevantEvents = events.filter(event => event.moduleId === module.id);
    const callCounts = new Map<string, number>();
    for (const event of relevantEvents) {
      if (event.type !== 'export_call' || !event.exportName) {
        continue;
      }
      callCounts.set(
        event.exportName,
        (callCounts.get(event.exportName) ?? 0) + 1,
      );
    }

    return module.exports
      .map(entry => {
        const callCount = callCounts.get(entry.name) ?? entry.callCount ?? 0;
        const reasons: string[] = [];
        if (callCount >= 5) {
          reasons.push('high runtime call count');
        }
        if (
          /(sign|sha|aes|sm3|sm4|md5|encrypt|decrypt|token|nonce)/i.test(
            entry.name,
          )
        ) {
          reasons.push('name matches signature/crypto keywords');
        }
        if (
          (entry.params?.length ?? 0) >= 2 &&
          (entry.results?.length ?? 0) <= 1
        ) {
          reasons.push('shape looks like transform routine');
        }
        return {
          name: entry.name,
          kind: entry.kind,
          callCount,
          params: entry.params,
          results: entry.results,
          suspicion: determineSuspicion(reasons.length, callCount),
          reasons,
        };
      })
      .sort(
        (a, b) => b.callCount - a.callCount || a.name.localeCompare(b.name),
      );
  }

  summarizeBoundary(
    module: WasmModuleRecord,
    events: WasmRuntimeEvent[],
  ): {
    importNamespaces: string[];
    topExports: string[];
    stackSamples: string[][];
    sideEffectHints: string[];
    candidateChains: WasmBoundaryChain[];
  } {
    const relevantEvents = events.filter(event => event.moduleId === module.id);
    const instantiateEvents = relevantEvents.filter(
      event => event.type !== 'export_call',
    );
    const exportUsage = this.summarizeExports(module, events).slice(0, 5);
    const candidateChains = this.buildBoundaryChains(module, events).slice(
      0,
      5,
    );
    return {
      importNamespaces: [...new Set(module.imports.map(entry => entry.module))],
      topExports: exportUsage.map(entry => entry.name),
      stackSamples: instantiateEvents
        .map(event => event.stackSummary ?? [])
        .filter(stack => stack.length > 0)
        .slice(0, 3),
      sideEffectHints: [
        ...new Set(
          relevantEvents.flatMap(event => event.sideEffectHints ?? []),
        ),
      ],
      candidateChains,
    };
  }

  buildBoundaryChains(
    module: WasmModuleRecord,
    events: WasmRuntimeEvent[],
  ): WasmBoundaryChain[] {
    const relevantEvents = events
      .filter(event => event.moduleId === module.id)
      .sort((a, b) => a.timestamp - b.timestamp);
    const chains: WasmBoundaryChain[] = [];

    for (const event of relevantEvents) {
      if (event.type !== 'export_call' || !event.exportName) {
        continue;
      }

      const runtimeModuleId = event.runtimeModuleId;
      const windowStart = event.timestamp - 1500;
      const windowEnd = event.timestamp + 2500;
      const related = relevantEvents.filter(candidate => {
        if (
          candidate.timestamp < windowStart ||
          candidate.timestamp > windowEnd
        ) {
          return false;
        }
        if (!runtimeModuleId || !candidate.runtimeModuleId) {
          return true;
        }
        return candidate.runtimeModuleId === runtimeModuleId;
      });

      const before = related.filter(
        candidate => candidate.timestamp <= event.timestamp,
      );
      const after = related.filter(
        candidate => candidate.timestamp >= event.timestamp,
      );

      const writerEvents = before.filter(
        candidate =>
          candidate.type === 'memory_write' ||
          candidate.type === 'text_encode' ||
          candidate.type === 'memory_view_create' ||
          candidate.type === 'memory_buffer_access',
      );
      const readerEvents = after.filter(
        candidate =>
          candidate.type === 'memory_read' || candidate.type === 'text_decode',
      );
      const sinkEvents = after.filter(
        candidate => candidate.type === 'network_request',
      );

      const writerHints = [
        ...new Set(
          writerEvents
            .map(candidate => describeRuntimeEvent(candidate))
            .filter(Boolean),
        ),
      ];
      const readerHints = [
        ...new Set(
          readerEvents
            .map(candidate => describeRuntimeEvent(candidate))
            .filter(Boolean),
        ),
      ];
      const sinkHints = [
        ...new Set(
          sinkEvents.map(candidate => describeSink(candidate)).filter(Boolean),
        ),
      ];
      const candidateJsCallers = [
        ...new Set(
          related
            .flatMap(candidate => candidate.stackSummary ?? [])
            .filter(
              line =>
                !line.includes('WebAssembly.') &&
                !line.includes('at wrappedExports'),
            ),
        ),
      ].slice(0, 6);
      const bodyAnalysis = buildBodyAnalysis(
        writerEvents,
        readerEvents,
        sinkEvents,
      );
      const headerCandidates = dedupeHeaders([
        ...sinkEvents.flatMap(candidate => candidate.requestHeaders ?? []),
        ...(event.resultEntries ?? []).map(entry => ({
          name: entry.key,
          value: entry.value,
          masked: entry.masked,
        })),
      ]);
      const returnValueHints = dedupeKeyValue(event.resultEntries ?? []);

      const steps: WasmBoundaryStep[] = related
        .map(candidate => this.toStep(candidate))
        .sort((a, b) => a.timestamp - b.timestamp);

      const score =
        writerEvents.length * 2 +
        readerEvents.length * 2 +
        sinkEvents.length * 3 +
        (writerEvents.some(candidate => candidate.type === 'text_encode')
          ? 2
          : 0) +
        (readerEvents.some(candidate => candidate.type === 'text_decode')
          ? 2
          : 0) +
        (sinkEvents.length > 0 ? 2 : 0) +
        (bodyAnalysis.segments.some(segment => segment.likelySignatureMaterial)
          ? 2
          : 0) +
        (headerCandidates.length > 0 ? 1 : 0);

      chains.push({
        moduleId: module.id,
        runtimeModuleId,
        exportName: event.exportName,
        score,
        startedAt: steps[0]?.timestamp ?? event.timestamp,
        endedAt: steps[steps.length - 1]?.timestamp ?? event.timestamp,
        writerHints,
        readerHints,
        sinkHints,
        candidateJsCallers,
        headerCandidates,
        returnValueHints,
        bodyAnalysis,
        networkTargets: sinkEvents.map(candidate => ({
          method: candidate.method,
          url: candidate.url,
          bodySnippet: candidate.bodySnippet,
          bodyKind: candidate.bodyKind,
          requestHeaders: candidate.requestHeaders
            ? [...candidate.requestHeaders]
            : undefined,
        })),
        steps,
      });
    }

    return chains.sort((a, b) => b.score - a.score || b.endedAt - a.endedAt);
  }

  buildStructuredBoundaryArtifact(
    modules: WasmModuleRecord[],
    events: WasmRuntimeEvent[],
  ): {
    generatedAt: string;
    modules: Array<{
      moduleId: string;
      hash: string;
      boundary: ReturnType<WasmRuntimeInspector['summarizeBoundary']>;
      exportUsage: WasmExportUsageSummary[];
    }>;
  } {
    return {
      generatedAt: new Date().toISOString(),
      modules: modules.map(module => ({
        moduleId: module.id,
        hash: module.hash,
        boundary: this.summarizeBoundary(module, events),
        exportUsage: this.summarizeExports(module, events),
      })),
    };
  }

  analyzeSignatureDiff(
    module: WasmModuleRecord,
    events: WasmRuntimeEvent[],
    options: {
      exportName?: string;
      maxChains?: number;
    } = {},
  ): WasmSignatureDiffResult {
    const chains = this.buildBoundaryChains(module, events)
      .filter(
        chain => !options.exportName || chain.exportName === options.exportName,
      )
      .filter(chain => chain.networkTargets.length > 0)
      .slice(0, options.maxChains ?? 12);

    const changedFields: WasmSignatureDiffFieldChange[] = [];
    const observations: string[] = [];

    const queryOrderValues = new Set<string>();
    const queryFields = new Map<string, Set<string>>();
    const headerFields = new Map<string, Set<string>>();
    const bodyFields = new Map<string, Set<string>>();

    for (const chain of chains) {
      const target = chain.networkTargets[0];
      const urlDetails = parseUrlDetails(target?.url);
      if (urlDetails.queryOrder) {
        queryOrderValues.add(urlDetails.queryOrder);
      }
      for (const [key, values] of urlDetails.queryValues.entries()) {
        const set = queryFields.get(key) ?? new Set<string>();
        for (const value of values) {
          set.add(value);
        }
        queryFields.set(key, set);
      }
      for (const header of target?.requestHeaders ?? []) {
        const key = normalizeHeaderName(header.name);
        const set = headerFields.get(key) ?? new Set<string>();
        set.add(header.value);
        headerFields.set(key, set);
      }
      const segments =
        chain.bodyAnalysis?.segments ??
        splitBodySegments(target?.bodySnippet, target?.bodyKind);
      for (const segment of segments) {
        const key = `segment_${segment.index}`;
        const set = bodyFields.get(key) ?? new Set<string>();
        set.add(segment.raw);
        bodyFields.set(key, set);
      }
    }

    if (queryOrderValues.size > 1) {
      changedFields.push({
        field: 'query-order',
        location: 'url-query-order',
        variationCount: queryOrderValues.size,
        examples: Array.from(queryOrderValues).slice(0, 4),
        impact: 'contextual',
        notes:
          'Observed different raw query-string ordering across boundary chains.',
      });
      observations.push(
        'URL query parameter order changes across captured boundary chains.',
      );
    }

    for (const [field, values] of queryFields.entries()) {
      if (values.size <= 1) {
        continue;
      }
      const impact: WasmSignatureDiffFieldChange['impact'] =
        /(timestamp|nonce|sign|signature|token)/i.test(field)
          ? 'signature-candidate'
          : 'contextual';
      changedFields.push({
        field,
        location: 'url-query',
        variationCount: values.size,
        examples: Array.from(values).slice(0, 4),
        impact,
        notes:
          impact === 'signature-candidate'
            ? 'This query key looks directly related to freshness or signature material.'
            : 'This query key changed across observed request variants.',
      });
    }

    for (const [field, values] of headerFields.entries()) {
      if (values.size <= 1) {
        continue;
      }
      const impact: WasmSignatureDiffFieldChange['impact'] =
        /(signature|timestamp|token|authorization)/i.test(field)
          ? 'signature-candidate'
          : 'transport-only';
      changedFields.push({
        field,
        location: 'request-header',
        variationCount: values.size,
        examples: Array.from(values)
          .slice(0, 4)
          .map(value =>
            isSensitiveHeader(field, value) ? maskValue(value) : value,
          ),
        impact,
        notes:
          impact === 'signature-candidate'
            ? 'Header value shifts look consistent with runtime signature generation.'
            : 'Header value variation looks more transport/context oriented.',
      });
    }

    for (const [field, values] of bodyFields.entries()) {
      if (values.size <= 1) {
        continue;
      }
      const examples = Array.from(values).slice(0, 4);
      const impact: WasmSignatureDiffFieldChange['impact'] = examples.some(
        value =>
          /^[0-9a-f]{16,}$/i.test(value) ||
          /^[A-Za-z0-9+/=_-]{16,}$/.test(value),
      )
        ? 'signature-candidate'
        : 'contextual';
      changedFields.push({
        field,
        location: 'body-segment',
        variationCount: values.size,
        examples: examples.map(value =>
          impact === 'signature-candidate' ? maskValue(value) : value,
        ),
        impact,
        notes:
          impact === 'signature-candidate'
            ? 'Body segment value looks like an encoded digest or token.'
            : 'Body segment varies, but does not look directly like a digest.',
      });
    }

    if (changedFields.some(field => field.impact === 'signature-candidate')) {
      observations.push(
        'At least one varying header/body/query field looks like candidate signature material.',
      );
    }
    if (
      chains.some(chain =>
        chain.bodyAnalysis?.segments.some(
          segment => segment.likelySignatureMaterial,
        ),
      )
    ) {
      observations.push(
        'Body-path tracing observed encoded-looking segments after Wasm export calls.',
      );
    }
    if (observations.length === 0) {
      observations.push(
        'No strong differential signal was found from the captured Wasm boundary chains.',
      );
    }

    return {
      moduleId: module.id,
      exportName: options.exportName,
      sampleCount: chains.length,
      comparedChains: chains.length,
      observations,
      changedFields,
    };
  }

  buildBoundaryReport(
    modules: WasmModuleRecord[],
    events: WasmRuntimeEvent[],
  ): string {
    const lines: string[] = ['# Wasm Boundary Report', ''];
    if (modules.length === 0) {
      lines.push('No Wasm modules captured in the current session.');
      return lines.join('\n');
    }

    for (const module of modules) {
      const boundary = this.summarizeBoundary(module, events);
      const exportUsage = this.summarizeExports(module, events).slice(0, 5);

      lines.push(`## ${module.id}`);
      lines.push(`- Hash: ${module.hash}`);
      lines.push(`- Load methods: ${module.loadMethods.join(', ')}`);
      lines.push(
        `- Import namespaces: ${joinOrNone(boundary.importNamespaces)}`,
      );
      lines.push(`- Top exports: ${joinOrNone(boundary.topExports)}`);
      lines.push(
        `- Side effects: ${joinOrFallback(boundary.sideEffectHints, 'not observed')}`,
      );
      if (boundary.candidateChains.length > 0) {
        lines.push('- Boundary chains:');
        for (const chain of boundary.candidateChains.slice(0, 3)) {
          lines.push(
            `  - ${chain.exportName}: score=${chain.score}, writers=${joinOrNone(chain.writerHints)}, readers=${joinOrNone(chain.readerHints)}, sinks=${joinOrNone(chain.sinkHints)}`,
          );
          if (chain.bodyAnalysis && chain.bodyAnalysis.segments.length > 0) {
            lines.push(
              `    body=${chain.bodyAnalysis.bodyKind}; segments=${chain.bodyAnalysis.segments.map(segment => segment.displayValue).join(' | ')}`,
            );
          }
          if (chain.headerCandidates.length > 0) {
            lines.push(
              `    headers=${chain.headerCandidates.map(entry => `${entry.name}=${entry.value}`).join('; ')}`,
            );
          }
        }
      }
      if (exportUsage.length > 0) {
        lines.push('- Export usage:');
        for (const usage of exportUsage) {
          lines.push(
            `  - ${usage.name}: calls=${usage.callCount}, suspicion=${usage.suspicion}${usage.reasons.length > 0 ? ` (${usage.reasons.join('; ')})` : ''}`,
          );
        }
      }
      if (boundary.stackSamples.length > 0) {
        lines.push('- Stack samples:');
        for (const stack of boundary.stackSamples) {
          lines.push(`  - ${stack.join(' | ')}`);
        }
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  private toStep(event: WasmRuntimeEvent): WasmBoundaryStep {
    return {
      type: event.type,
      timestamp: event.timestamp,
      description: describeStep(event),
      exportName: event.exportName,
      memoryExportName: event.memoryExportName,
      url: event.url,
      method: event.method,
      bodySnippet: event.bodySnippet,
      bodyKind: event.bodyKind,
      requestHeaders: event.requestHeaders
        ? [...event.requestHeaders]
        : undefined,
      resultEntries: event.resultEntries ? [...event.resultEntries] : undefined,
      stackSummary: event.stackSummary ? [...event.stackSummary] : undefined,
    };
  }
}
