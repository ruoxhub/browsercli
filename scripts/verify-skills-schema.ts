/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const REPO_ROOT = process.cwd();
const SKILLS_DIR = path.join(REPO_ROOT, 'skills');
const BUILD_TOOLS_DIR = path.join(REPO_ROOT, 'build/src/tools');

export interface ParamSchemaInfo {
  name: string;
  type:
    | 'string'
    | 'number'
    | 'boolean'
    | 'string[]'
    | 'object'
    | 'json'
    | 'unknown';
  required: boolean;
  hasDefault: boolean;
  defaultValue?: unknown;
  enumValues?: string[];
  description?: string;
}

export interface ToolSchemaInfo {
  name: string;
  parameters: Map<string, ParamSchemaInfo>;
  requiredParams: Set<string>;
}

export type ToolDefinitionsMap = Map<string, ToolSchemaInfo>;

export interface ExtractedArg {
  name: string;
  rawValue?: string;
  isBracketed: boolean;
}

export interface ExtractedCall {
  file: string;
  line: number;
  raw: string;
  toolName: string;
  isSynopsis: boolean;
  args: ExtractedArg[];
  dataPayload?: Record<string, unknown>;
  dataPayloadError?: string;
  rawFlags: Map<string, string | boolean | undefined>;
}

export interface ValidationError {
  file: string;
  line: number;
  raw: string;
  toolName: string;
  type:
    | 'unknown_tool'
    | 'unknown_param'
    | 'missing_required_param'
    | 'invalid_enum'
    | 'malformed_json'
    | 'type_mismatch';
  message: string;
}

/** Recognized global CLI flags for proxycli call */
export const GLOBAL_FLAGS: ReadonlySet<string> = new Set([
  'data',
  'file',
  'stdin',
  'session',
  'json',
  'help',
  'watch',
]);

function unquote(val: string): string {
  const trimmed = val.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Strips comments starting with `#` outside of quotes.
 */
function stripTrailingComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (ch === '#' && !inSingle && !inDouble) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line;
}

/**
 * Extracts proxycli call invocations from markdown content.
 */
export function extractCallsFromMarkdown(
  filePath: string,
  content: string,
): ExtractedCall[] {
  const rawLines = content.split('\n');
  const calls: ExtractedCall[] = [];

  const callRegex = /proxycli\s+call\s+([^\s`"'\\]+)(.*)/;

  let i = 0;
  while (i < rawLines.length) {
    const line = rawLines[i]!;
    const startLineNum = i + 1;

    // Check if line contains a call
    if (!line.includes('proxycli call')) {
      i++;
      continue;
    }

    // Handle multiline continuation with backslash \
    let combinedLine = line;
    while (combinedLine.trimEnd().endsWith('\\') && i + 1 < rawLines.length) {
      combinedLine =
        combinedLine.trimEnd().slice(0, -1) + ' ' + rawLines[i + 1];
      i++;
    }

    // Strip comments
    const cleanLine = stripTrailingComment(combinedLine);
    const match = cleanLine.match(callRegex);
    if (!match) {
      i++;
      continue;
    }

    const toolName = match[1]!.replace(/[`]/g, '');
    let restArgs = match[2] ?? '';

    // Stop at shell chaining operators like &&, ||, ;, or markdown closing backtick
    const endDelimMatch = restArgs.match(/(`|&&|\|\||;)/);
    if (endDelimMatch && endDelimMatch.index !== undefined) {
      restArgs = restArgs.slice(0, endDelimMatch.index);
    }

    // Determine if the call is a bracketed synopsis
    const isSynopsis =
      restArgs.includes('[--') ||
      cleanLine.includes('[--') ||
      toolName.startsWith('<') ||
      /\[\s*--[a-zA-Z0-9_-]+/.test(cleanLine);

    // Extract bracketed segments: find character ranges of [...]
    const bracketRanges: Array<{start: number; end: number}> = [];
    let bDepth = 0;
    let bStart = -1;
    for (let c = 0; c < restArgs.length; c++) {
      if (restArgs[c] === '[') {
        if (bDepth === 0) bStart = c;
        bDepth++;
      } else if (restArgs[c] === ']') {
        bDepth--;
        if (bDepth === 0 && bStart !== -1) {
          bracketRanges.push({start: bStart, end: c});
          bStart = -1;
        }
      }
    }

    const isInsideBrackets = (index: number) =>
      bracketRanges.some(r => index >= r.start && index <= r.end);

    // Tokenize flags and values
    const args: ExtractedArg[] = [];
    const rawFlags = new Map<string, string | boolean | undefined>();
    let dataPayload: Record<string, unknown> | undefined;
    let dataPayloadError: string | undefined;

    const flagRegex = /--([a-zA-Z0-9_-]+)(?:=|\s+)?/g;
    let flagMatch: RegExpExecArray | null;

    while ((flagMatch = flagRegex.exec(restArgs)) !== null) {
      const flagName = flagMatch[1]!;
      const flagIndex = flagMatch.index;
      const bracketed = isInsideBrackets(flagIndex);
      const afterFlagIndex = flagRegex.lastIndex;

      // Extract raw value if any
      let rawValue: string | undefined;
      const rest = restArgs.slice(afterFlagIndex).trimStart();

      if (restArgs[afterFlagIndex - 1] === '=') {
        // Value directly after =
        const valueMatch = rest.match(/^([^\s\]]+)/);
        if (valueMatch) {
          rawValue = valueMatch[1];
        }
      } else if (rest.length > 0) {
        if (rest.startsWith('"')) {
          const matchQuote = rest.match(/^"([^"\\]*(?:\\.[^"\\]*)*)"/);
          if (matchQuote) {
            rawValue = matchQuote[0];
          }
        } else if (rest.startsWith("'")) {
          const matchQuote = rest.match(/^'([^'\\]*(?:\\.[^'\\]*)*)'/);
          if (matchQuote) {
            rawValue = matchQuote[0];
          }
        } else if (rest.startsWith('<')) {
          const matchPlaceholder = rest.match(/^<[^>]+>/);
          if (matchPlaceholder) {
            rawValue = matchPlaceholder[0];
          }
        } else if (!rest.startsWith('--') && !rest.startsWith(']')) {
          const matchWord = rest.match(/^([^\s\]]+)/);
          if (matchWord && !matchWord[1]!.startsWith('--')) {
            rawValue = matchWord[1];
          }
        }
      }

      args.push({
        name: flagName,
        rawValue,
        isBracketed: bracketed,
      });

      rawFlags.set(flagName, rawValue ?? true);

      // If flag is --data, parse the JSON payload
      if (flagName === 'data' && rawValue !== undefined) {
        const unquoted = unquote(rawValue);
        if (
          !unquoted.startsWith('<') &&
          (unquoted.startsWith('{') || unquoted.startsWith('['))
        ) {
          try {
            const parsed = JSON.parse(unquoted);
            if (
              parsed &&
              typeof parsed === 'object' &&
              !Array.isArray(parsed)
            ) {
              dataPayload = parsed as Record<string, unknown>;
            }
          } catch (err) {
            dataPayloadError = (err as Error).message;
          }
        }
      }
    }

    calls.push({
      file: path.relative(REPO_ROOT, filePath),
      line: startLineNum,
      raw: combinedLine.trim(),
      toolName,
      isSynopsis,
      args,
      dataPayload,
      dataPayloadError,
      rawFlags,
    });

    i++;
  }

  return calls;
}

/**
 * Validates a single extracted tool call against tool definitions.
 */
export function validateCall(
  call: ExtractedCall,
  toolDefinitions: ToolDefinitionsMap,
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Ignore generic CLI template examples (e.g. <tool-name>, <tool_name>, <tool>)
  if (call.toolName.startsWith('<') && call.toolName.endsWith('>')) {
    return [];
  }

  const tool = toolDefinitions.get(call.toolName);
  if (!tool) {
    errors.push({
      file: call.file,
      line: call.line,
      raw: call.raw,
      toolName: call.toolName,
      type: 'unknown_tool',
      message: `Unknown tool "${call.toolName}". Tool definition not found in registry.`,
    });
    return errors;
  }

  // Check malformed JSON in --data
  if (call.dataPayloadError) {
    errors.push({
      file: call.file,
      line: call.line,
      raw: call.raw,
      toolName: call.toolName,
      type: 'malformed_json',
      message: `Malformed JSON in --data: ${call.dataPayloadError}`,
    });
  }

  const providedArgs = new Set<string>();

  // Validate flags passed directly on the command line
  for (const arg of call.args) {
    if (!arg.isBracketed) {
      providedArgs.add(arg.name);
    }

    // Check if it's a global flag
    if (GLOBAL_FLAGS.has(arg.name)) {
      continue;
    }

    const paramSchema = tool.parameters.get(arg.name);
    if (!paramSchema) {
      const allowedParams = Array.from(tool.parameters.keys());
      errors.push({
        file: call.file,
        line: call.line,
        raw: call.raw,
        toolName: call.toolName,
        type: 'unknown_param',
        message:
          `Unknown parameter "--${arg.name}" for tool "${call.toolName}". ` +
          `Allowed parameters: [${allowedParams.join(', ')}]`,
      });
      continue;
    }

    // Check enum values and JSON syntax if rawValue is provided
    if (arg.rawValue !== undefined) {
      const unquoted = unquote(arg.rawValue);

      // JSON validation for object/json/string[] types
      if (
        (paramSchema.type === 'object' ||
          paramSchema.type === 'json' ||
          paramSchema.type === 'string[]') &&
        (unquoted.startsWith('{') || unquoted.startsWith('[')) &&
        !unquoted.startsWith('<')
      ) {
        try {
          JSON.parse(unquoted);
        } catch (err) {
          errors.push({
            file: call.file,
            line: call.line,
            raw: call.raw,
            toolName: call.toolName,
            type: 'malformed_json',
            message: `Malformed JSON in parameter "--${arg.name}": ${(err as Error).message}`,
          });
        }
      }

      // Enum validation
      if (paramSchema.enumValues && paramSchema.enumValues.length > 0) {
        if (
          !unquoted.startsWith('<') &&
          !paramSchema.enumValues.includes(unquoted)
        ) {
          errors.push({
            file: call.file,
            line: call.line,
            raw: call.raw,
            toolName: call.toolName,
            type: 'invalid_enum',
            message:
              `Invalid enum value "${unquoted}" for parameter "--${arg.name}" on tool "${call.toolName}". ` +
              `Allowed values: [${paramSchema.enumValues.join(', ')}]`,
          });
        }
      }
    }
  }

  // Validate parameters inside --data payload
  if (call.dataPayload) {
    for (const [key, val] of Object.entries(call.dataPayload)) {
      providedArgs.add(key);

      const paramSchema = tool.parameters.get(key);
      if (!paramSchema) {
        errors.push({
          file: call.file,
          line: call.line,
          raw: call.raw,
          toolName: call.toolName,
          type: 'unknown_param',
          message: `Unknown parameter "${key}" in --data for tool "${call.toolName}".`,
        });
        continue;
      }

      if (paramSchema.enumValues && typeof val === 'string') {
        if (!paramSchema.enumValues.includes(val)) {
          errors.push({
            file: call.file,
            line: call.line,
            raw: call.raw,
            toolName: call.toolName,
            type: 'invalid_enum',
            message:
              `Invalid enum value "${val}" for parameter "${key}" in --data on tool "${call.toolName}". ` +
              `Allowed values: [${paramSchema.enumValues.join(', ')}]`,
          });
        }
      }
    }
  }

  // Enforce required parameters for non-synopsis executable examples
  // (unless --file or --stdin harness flag is used to provide args)
  const usesFileOrStdin =
    call.rawFlags.has('file') || call.rawFlags.has('stdin');

  if (!call.isSynopsis && !usesFileOrStdin) {
    for (const reqName of tool.requiredParams) {
      if (!providedArgs.has(reqName)) {
        errors.push({
          file: call.file,
          line: call.line,
          raw: call.raw,
          toolName: call.toolName,
          type: 'missing_required_param',
          message:
            `Missing required parameter "--${reqName}" for tool "${call.toolName}". ` +
            `Required parameters: [${Array.from(tool.requiredParams).join(', ')}]`,
        });
      }
    }
  }

  return errors;
}

/**
 * Validates markdown content directly against tool definitions.
 */
export function validateMarkdownContent(
  filePath: string,
  content: string,
  toolDefinitions: ToolDefinitionsMap,
): ValidationError[] {
  const calls = extractCallsFromMarkdown(filePath, content);
  const errors: ValidationError[] = [];

  for (const call of calls) {
    errors.push(...validateCall(call, toolDefinitions));
  }

  return errors;
}

/**
 * Collects all markdown files recursively under dir.
 */
export async function collectSkillFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, {withFileTypes: true});
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSkillFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Introspects a Zod schema property to extract type, required, enum, and default info.
 */
function introspectZodField(
  key: string,
  field: Record<string, unknown>,
): ParamSchemaInfo {
  let current: Record<string, unknown> = field;
  let isOptional = false;
  let hasDefault = false;
  let defaultValue: unknown = undefined;

  // Unwrap optional, default, effects, nullable
  while (current && typeof current === 'object') {
    const typeName =
      (current as {constructor?: {name?: string}}).constructor?.name ?? '';
    const def = (current['_def'] as Record<string, unknown>) ?? {};
    const typeNameDef = (def['typeName'] as string) ?? '';

    if (typeName === 'ZodOptional' || typeNameDef === 'ZodOptional') {
      isOptional = true;
      current = (
        typeof (current as {unwrap?: () => unknown}).unwrap === 'function'
          ? (current as {unwrap: () => Record<string, unknown>}).unwrap()
          : def['innerType']
      ) as Record<string, unknown>;
      continue;
    }

    if (typeName === 'ZodDefault' || typeNameDef === 'ZodDefault') {
      hasDefault = true;
      if (typeof def['defaultValue'] === 'function') {
        defaultValue = (def['defaultValue'] as () => unknown)();
      }
      current = (
        typeof (current as {removeDefault?: () => unknown}).removeDefault ===
        'function'
          ? (
              current as {removeDefault: () => Record<string, unknown>}
            ).removeDefault()
          : def['innerType']
      ) as Record<string, unknown>;
      continue;
    }

    if (typeName === 'ZodNullable' || typeNameDef === 'ZodNullable') {
      current = (
        typeof (current as {unwrap?: () => unknown}).unwrap === 'function'
          ? (current as {unwrap: () => Record<string, unknown>}).unwrap()
          : def['innerType']
      ) as Record<string, unknown>;
      continue;
    }

    if (typeName === 'ZodEffects' || typeNameDef === 'ZodEffects') {
      current = (
        typeof (current as {innerType?: () => unknown}).innerType === 'function'
          ? (current as {innerType: () => Record<string, unknown>}).innerType()
          : def['schema']
      ) as Record<string, unknown>;
      continue;
    }

    break;
  }

  const typeName =
    (current as {constructor?: {name?: string}}).constructor?.name ?? '';
  const def = (current['_def'] as Record<string, unknown>) ?? {};
  const typeNameDef = (def['typeName'] as string) ?? '';

  let resolvedType: ParamSchemaInfo['type'] = 'unknown';
  let enumValues: string[] | undefined;

  if (typeName === 'ZodString' || typeNameDef === 'ZodString') {
    resolvedType = 'string';
  } else if (typeName === 'ZodNumber' || typeNameDef === 'ZodNumber') {
    resolvedType = 'number';
  } else if (typeName === 'ZodBoolean' || typeNameDef === 'ZodBoolean') {
    resolvedType = 'boolean';
  } else if (typeName === 'ZodEnum' || typeNameDef === 'ZodEnum') {
    resolvedType = 'string';
    enumValues = def['values'] as string[];
  } else if (typeName === 'ZodNativeEnum' || typeNameDef === 'ZodNativeEnum') {
    resolvedType = 'string';
    if (def['values'] && typeof def['values'] === 'object') {
      enumValues = Object.values(def['values'] as Record<string, string>);
    }
  } else if (typeName === 'ZodArray' || typeNameDef === 'ZodArray') {
    const elem = (def['type'] ?? def['element']) as Record<string, unknown>;
    const elemType =
      elem?.constructor?.name ??
      (elem?.['_def'] as Record<string, unknown>)?.['typeName'];
    if (elemType === 'ZodString') {
      resolvedType = 'string[]';
    } else if (elemType === 'ZodObject' || elemType === 'ZodRecord') {
      resolvedType = 'json';
    } else {
      resolvedType = 'unknown';
    }
  } else if (
    typeName === 'ZodObject' ||
    typeNameDef === 'ZodObject' ||
    typeName === 'ZodRecord' ||
    typeNameDef === 'ZodRecord'
  ) {
    resolvedType = 'object';
  } else if (typeName === 'ZodUnion' || typeNameDef === 'ZodUnion') {
    const options = (def['options'] as Array<Record<string, unknown>>) ?? [];
    const allLiterals =
      options.length > 0 &&
      options.every(opt => {
        const optName =
          opt?.constructor?.name ??
          (opt?.['_def'] as Record<string, unknown>)?.['typeName'];
        return optName === 'ZodLiteral';
      });
    if (allLiterals) {
      resolvedType = 'string';
      enumValues = options.map(
        opt => (opt['_def'] as Record<string, unknown>)?.['value'] as string,
      );
    } else {
      resolvedType = 'unknown';
    }
  }

  const description =
    (current?.['description'] as string) ??
    (field?.['description'] as string) ??
    undefined;

  return {
    name: key,
    type: resolvedType,
    required: !isOptional && !hasDefault,
    hasDefault,
    defaultValue,
    enumValues,
    description,
  };
}

/**
 * Loads canonical tool definitions from the compiled tools index.
 */
export async function loadToolDefinitions(
  toolsDir = BUILD_TOOLS_DIR,
): Promise<ToolDefinitionsMap> {
  const toolMap: ToolDefinitionsMap = new Map();

  try {
    const indexPath = path.join(toolsDir, 'generated-tools-index.js');
    const indexUrl = pathToFileURL(indexPath).href;
    const indexMod = (await import(indexUrl)) as {
      GENERATED_TOOL_REGISTRY: Array<{
        modulePath: string;
        handlerName: string;
      }>;
    };

    for (const entry of indexMod.GENERATED_TOOL_REGISTRY) {
      try {
        const modulePath = path.join(toolsDir, entry.modulePath);
        const moduleUrl = pathToFileURL(modulePath).href;
        const mod = (await import(moduleUrl)) as Record<string, unknown>;
        const tool = mod[entry.handlerName] as
          | {
              name?: string;
              schema?: Record<string, Record<string, unknown>>;
            }
          | undefined;
        if (!tool || typeof tool !== 'object' || !tool.name) continue;

        const parameters = new Map<string, ParamSchemaInfo>();
        const requiredParams = new Set<string>();

        if (tool.schema && typeof tool.schema === 'object') {
          for (const [key, field] of Object.entries(tool.schema)) {
            const paramInfo = introspectZodField(key, field);
            parameters.set(key, paramInfo);
            if (paramInfo.required) {
              requiredParams.add(key);
            }
          }
        }

        toolMap.set(tool.name, {
          name: tool.name,
          parameters,
          requiredParams,
        });
      } catch {
        // empty
      }
    }
  } catch (err) {
    console.warn(
      `⚠️  无法加载编译后的 tools 索引: ${err instanceof Error ? err.message : String(err)}，请先执行 npm run build`,
    );
  }

  return toolMap;
}

/**
 * Runs verification over all skill markdown files.
 */
export async function runVerification(options?: {
  skillsDir?: string;
  toolsDir?: string;
}): Promise<{errorCount: number; errors: ValidationError[]}> {
  const skillsDir = options?.skillsDir ?? SKILLS_DIR;
  const toolsDir = options?.toolsDir ?? BUILD_TOOLS_DIR;

  console.log(
    '🔍 开始扫描 skills/**/*.md 文档中的 proxycli call 调用参数...',
  );
  const skillFiles = await collectSkillFiles(skillsDir);
  const toolMap = await loadToolDefinitions(toolsDir);

  const allCalls: ExtractedCall[] = [];
  for (const file of skillFiles) {
    const content = await readFile(file, 'utf8');
    allCalls.push(...extractCallsFromMarkdown(file, content));
  }

  console.log(
    `📄 找到 ${skillFiles.length} 个 Skill 文档，共检测到 ${allCalls.length} 处 proxycli call 命令`,
  );

  const allErrors: ValidationError[] = [];

  for (const call of allCalls) {
    const errors = validateCall(call, toolMap);
    for (const err of errors) {
      allErrors.push(err);
      console.warn(
        `⚠️  [${err.type}] ${err.file}:${err.line}\n` +
          `   命令: "${err.raw}"\n` +
          `   ${err.message}`,
      );
    }
  }

  if (allErrors.length > 0) {
    console.log(
      `\n❌ 发现 ${allErrors.length} 处 Skill 文档与 Tool Schema 参数不匹配！`,
    );
  } else {
    console.log(
      '✅ 所有 Skill 文档中的 proxycli call 参数与代码 Schema 完全一致！',
    );
  }

  return {
    errorCount: allErrors.length,
    errors: allErrors,
  };
}

// Auto-run if executed directly as entry script
const isMain =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  const result = await runVerification();
  if (result.errorCount > 0) {
    process.exitCode = 1;
  }
}
