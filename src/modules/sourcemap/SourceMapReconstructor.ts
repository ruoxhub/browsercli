/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {createHash, randomUUID} from 'node:crypto';
import {lstat, mkdir, open, rename, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {validateOutputPath} from '../../utils/fsSafe.js';

import type {SourceMapDocument} from './SourceMapDocument.js';
import {
  SourceMapError,
  type SourceMapManifestEntry,
  type SourceMapReconstructInput,
  type SourceMapReconstructResult,
} from './types.js';

const RESERVED_WINDOWS_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
// C0 control characters are intentionally rejected from reconstructed paths.
// eslint-disable-next-line no-control-regex
const INVALID_PATH_CHARACTER = /[\u0000-\u001f<>:"|?*]/g;

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function normalizedInputPath(source: string): string {
  const slashed = source.replace(/\\/g, '/');
  if (/^[a-zA-Z]:\//.test(slashed)) return slashed.slice(2);
  try {
    const url = new URL(slashed);
    return url.pathname;
  } catch {
    return slashed;
  }
}

export function normalizeSourcePath(source: string, index: number): string {
  const parts: string[] = [];
  for (const rawPart of normalizedInputPath(source).split('/')) {
    if (rawPart === '' || rawPart === '.') continue;
    if (rawPart === '..') {
      parts.pop();
      continue;
    }
    let part = rawPart
      .replace(INVALID_PATH_CHARACTER, '_')
      .replace(/[. ]+$/g, '');
    if (RESERVED_WINDOWS_NAME.test(part)) part = `_${part}`;
    if (part !== '') parts.push(part);
  }
  return parts.join('/') || `source-${index}`;
}

async function statIfExists(target: string) {
  try {
    return await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function pathBlocked(message: string): SourceMapError {
  return new SourceMapError('PATH_BLOCKED', message);
}

async function ensureDirectoryWithoutSymlinks(
  directory: string,
): Promise<void> {
  const resolved = path.resolve(directory);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  for (const segment of resolved.slice(parsed.root.length).split(path.sep)) {
    if (!segment) continue;
    current = path.join(current, segment);
    const stat = await statIfExists(current);
    if (stat?.isSymbolicLink()) {
      throw pathBlocked(`Refusing to follow symlink: ${current}`);
    }
    if (stat && !stat.isDirectory()) {
      throw pathBlocked(`Output path segment is not a directory: ${current}`);
    }
    if (!stat) {
      await mkdir(current);
      const created = await lstat(current);
      if (created.isSymbolicLink()) {
        throw pathBlocked(`Refusing to follow symlink: ${current}`);
      }
    }
  }
}

function assertBelowRoot(root: string, target: string): void {
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw pathBlocked(`Output path escapes the reconstruction root: ${target}`);
  }
}

async function atomicWrite(
  root: string,
  target: string,
  content: string,
  overwrite: boolean,
): Promise<'written' | 'skipped'> {
  assertBelowRoot(root, target);
  await ensureDirectoryWithoutSymlinks(path.dirname(target));
  const existing = await statIfExists(target);
  if (existing?.isSymbolicLink()) {
    throw pathBlocked(`Refusing to overwrite symlink: ${target}`);
  }
  if (existing && !overwrite) return 'skipped';
  if (existing?.isDirectory()) {
    throw pathBlocked(`Output file is an existing directory: ${target}`);
  }

  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${randomUUID()}.tmp`,
  );
  const handle = await open(temporary, 'wx');
  try {
    await handle.writeFile(content, 'utf8');
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, {force: true});
    throw error;
  }
  return 'written';
}

function collisionPath(relative: string, hash: string): string {
  const extension = path.posix.extname(relative);
  const basename = path.posix.basename(relative, extension);
  const directory = path.posix.dirname(relative);
  const filename = `${basename}~${hash.slice(0, 8)}${extension}`;
  return directory === '.' ? filename : path.posix.join(directory, filename);
}

export class SourceMapReconstructor {
  async reconstruct(
    document: SourceMapDocument,
    input: SourceMapReconstructInput,
  ): Promise<SourceMapReconstructResult> {
    const rootDir = validateOutputPath(input.outputDir ?? '');
    const forbidden = [
      path.parse(rootDir).root,
      os.homedir(),
      process.cwd(),
    ].map(value => path.resolve(value));
    if (forbidden.includes(rootDir)) {
      throw pathBlocked(`Refusing unsafe reconstruction root: ${rootDir}`);
    }
    await ensureDirectoryWithoutSymlinks(rootDir);

    const entries: SourceMapManifestEntry[] = [];
    const claimed = new Map<string, {hash: string; outputPath: string}>();
    let written = 0;
    let skipped = 0;
    let missing = 0;
    let collisions = 0;

    for (const source of document.getSources()) {
      const normalized = normalizeSourcePath(source.source, source.index);
      if (source.content === null) {
        missing += 1;
        entries.push({
          source: source.source,
          outputPath: normalized,
          status: 'missing',
          warnings: ['sourcesContent is missing'],
        });
        continue;
      }

      const hash = sha256(source.content);
      const bytes = Buffer.byteLength(source.content);
      const existingClaim = claimed.get(normalized);
      let outputPath = normalized;
      let collision = false;
      if (existingClaim) {
        collisions += 1;
        collision = true;
        if (existingClaim.hash === hash) {
          outputPath = existingClaim.outputPath;
        } else {
          outputPath = collisionPath(normalized, hash);
        }
      }

      if (!existingClaim || existingClaim.hash !== hash) {
        const target = path.resolve(rootDir, ...outputPath.split('/'));
        const status = await atomicWrite(
          rootDir,
          target,
          source.content,
          input.overwrite,
        );
        if (status === 'written') written += 1;
        else skipped += 1;
        claimed.set(normalized, {hash, outputPath});
        entries.push({
          source: source.source,
          outputPath,
          status: collision ? 'collision' : status,
          sha256: hash,
          bytes,
          warnings: [],
        });
      } else {
        entries.push({
          source: source.source,
          outputPath,
          status: 'collision',
          sha256: hash,
          bytes,
          warnings: ['Reused identical normalized source content'],
        });
      }
    }

    const manifestPath = path.join(rootDir, 'sourcemap-manifest.json');
    const result: SourceMapReconstructResult = {
      rootDir,
      manifestPath,
      written,
      skipped,
      missing,
      collisions,
      entries,
    };
    await atomicWrite(
      rootDir,
      manifestPath,
      `${JSON.stringify({mapId: input.mapId, ...result}, null, 2)}\n`,
      true,
    );
    return result;
  }
}
