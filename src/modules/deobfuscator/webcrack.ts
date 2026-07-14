/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * webcrack 适配层
 *
 * 目标：在主反混淆管线中，作为前置 Step 0.5 引入 webcrack 的能力
 * （bundle 拆包 / unminify / javascript-obfuscator 反向 / mangle 反向）。
 * 失败、不可用、Node 版本不匹配时返回 applied:false，由调用方兜底。
 */

import {readdir, rm, stat} from 'node:fs/promises';
import path from 'node:path';

import type {
  DeobfuscateBundleModuleSummary,
  DeobfuscateBundleSummary,
  DeobfuscateMappingRule,
  DeobfuscateOptions,
  DeobfuscateSavedArtifact,
} from '../../types/index.js';
import {logger} from '../../utils/logger.js';

interface WebcrackModuleLike {
  id: string;
  path: string;
  isEntry: boolean;
  code: string;
}

interface WebcrackBundleLike {
  type: 'webpack' | 'browserify';
  entryId: string;
  modules: Map<string, WebcrackModuleLike>;
}

interface WebcrackResultLike {
  code: string;
  bundle?: WebcrackBundleLike;
  save: (targetPath: string) => Promise<void>;
}

interface WebcrackRuntimeOptions {
  jsx?: boolean;
  unpack?: boolean;
  deobfuscate?: boolean;
  unminify?: boolean;
  mangle?: boolean;
  sandbox?: unknown;
}

interface WebcrackModuleImport {
  webcrack: (
    code: string,
    options?: WebcrackRuntimeOptions,
  ) => Promise<WebcrackResultLike>;
}

type WebcrackInvocationOptions = Pick<
  DeobfuscateOptions,
  | 'forceOutput'
  | 'includeModuleCode'
  | 'jsx'
  | 'mangle'
  | 'mappings'
  | 'maxBundleModules'
  | 'outputDir'
  | 'unminify'
  | 'unpack'
>;

export interface WebcrackExecutionResult {
  applied: boolean;
  code: string;
  bundle?: DeobfuscateBundleSummary;
  savedTo?: string;
  savedArtifacts?: DeobfuscateSavedArtifact[];
  optionsUsed: Required<
    Pick<DeobfuscateOptions, 'jsx' | 'mangle' | 'unminify' | 'unpack'>
  >;
  reason?: string;
}

const DEFAULT_OPTIONS: Required<
  Pick<DeobfuscateOptions, 'jsx' | 'mangle' | 'unminify' | 'unpack'>
> = {
  jsx: true,
  mangle: false,
  unminify: true,
  unpack: true,
};

const MAX_BUNDLE_MODULES = 100;

interface MappingMetadata {
  fromPath: string;
}

function normalizeOptions(
  options: WebcrackInvocationOptions,
): Required<
  Pick<DeobfuscateOptions, 'jsx' | 'mangle' | 'unminify' | 'unpack'>
> {
  return {
    jsx: options.jsx ?? DEFAULT_OPTIONS.jsx,
    mangle: options.mangle ?? DEFAULT_OPTIONS.mangle,
    unminify: options.unminify ?? DEFAULT_OPTIONS.unminify,
    unpack: options.unpack ?? DEFAULT_OPTIONS.unpack,
  };
}

/** webcrack 仅在 Node 22.12+ 与 Node 24.x 上支持 */
export function isSupportedNodeVersion(): boolean {
  const [majorPart = '0', minorPart = '0'] = process.versions.node.split('.');
  const major = Number.parseInt(majorPart, 10);
  const minor = Number.parseInt(minorPart, 10);

  if (!Number.isFinite(major) || !Number.isFinite(minor)) {
    return false;
  }
  if (major === 22) return minor >= 12;
  return major === 24;
}

function matchesRule(
  module: WebcrackModuleLike,
  rule: DeobfuscateMappingRule,
): boolean {
  const target = rule.target === 'path' ? module.path : module.code;
  const matchType = rule.matchType ?? 'includes';
  if (matchType === 'exact') return target === rule.pattern;
  if (matchType === 'regex') {
    try {
      return new RegExp(rule.pattern, 'm').test(target);
    } catch {
      return false;
    }
  }
  return target.includes(rule.pattern);
}

function applyBundleMappings(
  bundle: WebcrackBundleLike,
  mappings: DeobfuscateMappingRule[] | undefined,
): Map<string, MappingMetadata> {
  const remapped = new Map<string, MappingMetadata>();
  if (!mappings || mappings.length === 0) return remapped;

  for (const module of bundle.modules.values()) {
    for (const rule of mappings) {
      if (!rule.path || !rule.pattern) continue;
      if (matchesRule(module, rule)) {
        if (module.path !== rule.path) {
          remapped.set(module.id, {fromPath: module.path});
          module.path = rule.path;
        }
        break;
      }
    }
  }
  return remapped;
}

function summarizeBundle(
  bundle: WebcrackBundleLike,
  options: Pick<DeobfuscateOptions, 'includeModuleCode' | 'maxBundleModules'>,
  remapped: Map<string, MappingMetadata>,
): DeobfuscateBundleSummary {
  const maxBundleModules = options.maxBundleModules ?? MAX_BUNDLE_MODULES;
  const modules = Array.from(bundle.modules.values())
    .sort((a, b) => {
      if (a.isEntry !== b.isEntry) return a.isEntry ? -1 : 1;
      return a.path.localeCompare(b.path);
    })
    .slice(0, maxBundleModules)
    .map<DeobfuscateBundleModuleSummary>(module => ({
      id: module.id,
      path: module.path,
      isEntry: module.isEntry,
      size: module.code.length,
      code: options.includeModuleCode ? module.code : undefined,
      mappedPathFrom: remapped.get(module.id)?.fromPath,
    }));

  return {
    type: bundle.type,
    entryId: bundle.entryId,
    moduleCount: bundle.modules.size,
    truncated: bundle.modules.size > maxBundleModules,
    mappingsApplied: remapped.size,
    modules,
  };
}

async function collectSavedArtifacts(
  rootDir: string,
  currentDir = rootDir,
): Promise<DeobfuscateSavedArtifact[]> {
  const entries = await readdir(currentDir, {withFileTypes: true});
  const artifacts: DeobfuscateSavedArtifact[] = [];

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      artifacts.push(...(await collectSavedArtifacts(rootDir, fullPath)));
      continue;
    }
    if (!entry.isFile()) continue;

    const meta = await stat(fullPath);
    artifacts.push({
      path: path.relative(rootDir, fullPath).replace(/\\/g, '/'),
      size: meta.size,
      type: 'file',
    });
  }

  return artifacts.sort((a, b) => a.path.localeCompare(b.path));
}

function assertOutputDirSafe(savedTo: string): void {
  const cwd = process.cwd();
  const relFromCwd = path.relative(cwd, savedTo);
  if (
    path.isAbsolute(relFromCwd) ||
    relFromCwd.startsWith('..') ||
    savedTo === '/' ||
    savedTo === path.parse(savedTo).root
  ) {
    throw new Error(
      `outputDir must resolve to a path within the project root. Got: ${savedTo}`,
    );
  }
}

export async function runWebcrack(
  code: string,
  options: WebcrackInvocationOptions,
): Promise<WebcrackExecutionResult> {
  const optionsUsed = normalizeOptions(options);

  if (!isSupportedNodeVersion()) {
    const reason = `webcrack requires Node.js 22.12+ or 24.x; current runtime is ${process.versions.node}`;
    logger.warn(reason);
    return {applied: false, code, optionsUsed, reason};
  }

  // 验证 outputDir 安全 —— 在调用 webcrack 之前抛错，避免做无用功
  let savedTo: string | undefined;
  if (
    typeof options.outputDir === 'string' &&
    options.outputDir.trim().length > 0
  ) {
    savedTo = path.resolve(options.outputDir);
    assertOutputDirSafe(savedTo);
  }

  let webcrackModule: WebcrackModuleImport;
  try {
    webcrackModule = (await import('webcrack')) as WebcrackModuleImport;
  } catch (error) {
    const reason =
      error instanceof Error
        ? `webcrack module not available: ${error.message}`
        : 'webcrack module not available';
    logger.warn(reason);
    return {applied: false, code, optionsUsed, reason};
  }

  try {
    const result = await webcrackModule.webcrack(code, {
      jsx: optionsUsed.jsx,
      unpack: optionsUsed.unpack,
      deobfuscate: true,
      unminify: optionsUsed.unminify,
      mangle: optionsUsed.mangle,
    });

    const remapped = result.bundle
      ? applyBundleMappings(result.bundle, options.mappings)
      : new Map<string, MappingMetadata>();

    let savedArtifacts: DeobfuscateSavedArtifact[] | undefined;
    if (savedTo) {
      if (options.forceOutput) {
        await rm(savedTo, {recursive: true, force: true});
      }
      await result.save(savedTo);
      savedArtifacts = await collectSavedArtifacts(savedTo);
    }

    return {
      applied: true,
      code: result.code,
      bundle: result.bundle
        ? summarizeBundle(
            result.bundle,
            {
              includeModuleCode: options.includeModuleCode,
              maxBundleModules: options.maxBundleModules,
            },
            remapped,
          )
        : undefined,
      savedTo,
      savedArtifacts,
      optionsUsed,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn('webcrack execution failed, falling back to legacy pipeline');
    return {applied: false, code, optionsUsed, reason};
  }
}
