/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {BytecodeExtractor} from './BytecodeExtractor.js';
import {
  createCDPSessionFrom,
  type CDPSessionLike,
} from './CDPSessionAdapter.js';
import {isRecord} from './isRecord.js';
import {VersionDetector} from './VersionDetector.js';

interface RuntimeEvaluateResponse {
  result?: unknown;
}

interface OptimizationProbe {
  status: number | null;
  activeTier: string | null;
}

export interface JITInfo {
  functionName: string;
  optimized: boolean;
  tier: string;
  address?: string;
}

export interface JITInspectionResult {
  functions: JITInfo[];
  supportsNativesSyntax: boolean;
  inspectionMode: 'native-status' | 'heuristic';
}

function readOptimizationProbe(value: unknown): OptimizationProbe {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return {status: value, activeTier: null};
  }
  if (!isRecord(value)) {
    return {status: null, activeTier: null};
  }
  if ('value' in value) {
    return readOptimizationProbe(value['value']);
  }
  return {
    status:
      typeof value['status'] === 'number' && Number.isFinite(value['status'])
        ? value['status']
        : null,
    activeTier:
      typeof value['activeTier'] === 'string' ? value['activeTier'] : null,
  };
}

function mapOptimizationTier(probe: OptimizationProbe): {
  optimized: boolean;
  tier: string;
} {
  if (probe.activeTier) {
    return {
      optimized: probe.activeTier !== 'ignition',
      tier: probe.activeTier,
    };
  }

  const {status} = probe;
  if (status === null) {
    return {optimized: false, tier: 'unknown'};
  }
  // Numeric status bits changed between V8 releases. Prefer the active-tier
  // intrinsics above; this fallback recognizes both legacy TurboFan bits.
  if ((status & 64) !== 0 || (status & 32) !== 0) {
    return {optimized: true, tier: 'turbofan'};
  }
  if ((status & 16) !== 0) {
    return {optimized: true, tier: 'optimized'};
  }
  if ((status & 8) !== 0) {
    return {optimized: true, tier: 'optimized'};
  }
  return {optimized: false, tier: 'interpreted'};
}

export class JITInspector {
  private readonly bytecodeExtractor: BytecodeExtractor;
  private readonly versionDetector: VersionDetector;
  private optimizedFunctionsCache: JITInfo[] = [];

  constructor(private readonly getPage?: () => Promise<unknown>) {
    this.bytecodeExtractor = new BytecodeExtractor(getPage);
    this.versionDetector = new VersionDetector(getPage);
  }

  async inspectJIT(scriptId: string): Promise<JITInspectionResult> {
    const hiddenClasses =
      await this.bytecodeExtractor.findHiddenClasses(scriptId);
    const extraction = await this.bytecodeExtractor.extractBytecode(scriptId);
    const functionNames = new Set<string>();

    if (extraction) {
      functionNames.add(extraction.functionName);
    }

    for (const hiddenClass of hiddenClasses) {
      const candidate = hiddenClass.properties[0];
      if (candidate) {
        functionNames.add(candidate);
      }
    }

    if (functionNames.size === 0) {
      functionNames.add('anonymous');
    }

    const supportsNativesSyntax =
      await this.versionDetector.supportsNativesSyntax();
    const results: JITInfo[] = [];

    for (const functionName of functionNames) {
      const probe = supportsNativesSyntax
        ? await this.getOptimizationProbe(functionName)
        : {status: null, activeTier: null};
      const {optimized, tier} = mapOptimizationTier(probe);

      results.push({
        functionName,
        optimized,
        tier,
      });
    }

    this.optimizedFunctionsCache = results;
    return {
      functions: results,
      supportsNativesSyntax,
      inspectionMode: supportsNativesSyntax ? 'native-status' : 'heuristic',
    };
  }

  async forceDeoptimization(functionRef: string): Promise<void> {
    const supportsNativesSyntax =
      await this.versionDetector.supportsNativesSyntax();
    if (!supportsNativesSyntax) {
      return;
    }

    const session = await this.createSession();
    if (!session) {
      return;
    }

    try {
      await session.send('Runtime.evaluate', {
        expression: `
          (() => {
            try {
              const candidate = eval(${JSON.stringify(functionRef)});
              if (typeof candidate === 'function') {
                %DeoptimizeFunction(candidate);
              }
            } catch (error) {
              return undefined;
            }
            return undefined;
          })()
        `,
        returnByValue: true,
        awaitPromise: false,
      });
    } finally {
      await session.detach().catch(() => undefined);
    }
  }

  async getOptimizedFunctions(): Promise<JITInfo[]> {
    return [...this.optimizedFunctionsCache];
  }

  private async getOptimizationProbe(
    functionName: string,
  ): Promise<OptimizationProbe> {
    const session = await this.createSession();
    if (!session) {
      return {status: null, activeTier: null};
    }

    try {
      const response = await session.send<RuntimeEvaluateResponse>(
        'Runtime.evaluate',
        {
          expression: `
          (() => {
            try {
              const candidate = globalThis[${JSON.stringify(functionName)}];
              if (typeof candidate !== 'function') {
                return null;
              }
              const tierChecks = [
                ['turbofan', 'return %ActiveTierIsTurbofan(candidate)'],
                ['maglev', 'return %ActiveTierIsMaglev(candidate)'],
                ['sparkplug', 'return %ActiveTierIsSparkplug(candidate)'],
                ['ignition', 'return %ActiveTierIsIgnition(candidate)'],
              ];
              let activeTier = null;
              for (const [tier, body] of tierChecks) {
                try {
                  if (new Function('candidate', body)(candidate) === true) {
                    activeTier = tier;
                    break;
                  }
                } catch (error) {
                  // The intrinsic is unavailable in this V8 release.
                }
              }
              return {
                status: %GetOptimizationStatus(candidate),
                activeTier,
              };
            } catch (error) {
              return null;
            }
          })()
        `,
          returnByValue: true,
          awaitPromise: false,
        },
      );

      if (!isRecord(response)) {
        return {status: null, activeTier: null};
      }

      return readOptimizationProbe(response['result']);
    } catch {
      return {status: null, activeTier: null};
    } finally {
      await session.detach().catch(() => undefined);
    }
  }

  private async createSession(): Promise<CDPSessionLike | null> {
    return createCDPSessionFrom(this.getPage);
  }
}
