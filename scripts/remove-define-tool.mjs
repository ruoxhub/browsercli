#!/usr/bin/env node
/**
 * Script to remove defineTool() wrapper from all tool files.
 * Transforms:
 *   export const x = defineTool({...})  →  export const x = {...} satisfies ToolDefinition
 *   import {defineTool} from './ToolDefinition.js'  →  import type {ToolDefinition} from './ToolDefinition.js'
 */
import {readFileSync, writeFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';

import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = join(__dirname, '..', 'src', 'tools');

function walkDir(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...walkDir(fullPath));
    } else if (entry.endsWith('.ts') && entry !== 'ToolDefinition.ts' && entry !== 'ToolRegistry.ts' && entry !== 'categories.ts' && entry !== 'runtime.ts') {
      results.push(fullPath);
    }
  }
  return results;
}

function transformFile(filePath) {
  let content = readFileSync(filePath, 'utf8');
  const originalContent = content;

  // Check if file uses defineTool
  if (!content.includes('defineTool')) {
    return false;
  }

  // 1. Transform defineTool({...}) → {...} satisfies ToolDefinition
  // Handle multi-line defineTool calls
  // Pattern: defineTool({  →  { ... }) satisfies ToolDefinition
  content = content.replace(/defineTool\(\s*\{/g, '{');

  // Now we need to close the satisfies ToolDefinition
  // The tricky part: each defineTool({...}) becomes {...} satisfies ToolDefinition
  // We need to find the closing }) for each opening defineTool({
  // Actually, let's use a different approach: count the braces

  // Actually the simpler approach: replace }) at the end of tool definitions with } satisfies ToolDefinition
  // The pattern is: defineTool({ ... })  → { ... } satisfies ToolDefinition
  // After step 1, we have: { ... }) - we need to change }) to } satisfies ToolDefinition

  // But }) might appear in other contexts (like handler functions with arrow functions)
  // Let's be more precise: find the pattern where we have a closing }) that was originally defineTool({...})

  // Better approach: do it in one pass using regex replacement
  // Reset and redo
  content = originalContent;

  // Replace: = defineTool({  →  = { ... }) satisfies ToolDefinition
  // The key insight: each defineTool({...}) is assigned to an export const
  // So the pattern is: = defineTool({ ... })
  // After removing defineTool(, we have: = { ... })
  // We need: = { ... } satisfies ToolDefinition

  // Step 1: Remove defineTool( wrapper - replace defineTool( with nothing
  // But we need to track where to add satisfies ToolDefinition

  // Simple approach: Replace the pattern "defineTool({" with just "{", and then
  // replace the matching "})" with "} satisfies ToolDefinition"

  // For each occurrence of defineTool({, find the matching }) and replace it
  let result = '';
  let i = 0;
  while (i < content.length) {
    // Look for defineTool(
    const idx = content.indexOf('defineTool(', i);
    if (idx === -1) {
      result += content.slice(i);
      break;
    }

    // Check if this is actually defineTool({ (with opening brace)
    const afterParen = content.slice(idx + 'defineTool('.length);
    const trimmed = afterParen.trimStart();
    if (!trimmed.startsWith('{')) {
      // Not defineTool({...}, just copy as-is
      result += content.slice(i, idx + 'defineTool('.length);
      i = idx + 'defineTool('.length;
      continue;
    }

    // Copy everything before defineTool(
    result += content.slice(i, idx);

    // Skip 'defineTool('
    i = idx + 'defineTool('.length;

    // Skip whitespace
    while (i < content.length && /\s/.test(content[i])) {
      result += content[i];
      i++;
    }

    // Now we should be at '{'
    // Find the matching closing brace and then the closing paren
    let braceCount = 0;
    let inString = false;
    let stringChar = '';
    let inTemplate = false;
    let templateDepth = 0;
    const startI = i;

    while (i < content.length) {
      const ch = content[i];
      const prevCh = i > 0 ? content[i - 1] : '';

      // Handle string literals
      if (inString) {
        if (ch === '\\' && !inTemplate) {
          i += 2;
          continue;
        }
        if (ch === stringChar) {
          inString = false;
        }
        i++;
        continue;
      }

      // Handle template literals
      if (inTemplate) {
        if (ch === '`') {
          inTemplate = false;
        } else if (ch === '$' && content[i + 1] === '{') {
          templateDepth++;
          i += 2;
          continue;
        } else if (ch === '}' && templateDepth > 0) {
          templateDepth--;
        }
        i++;
        continue;
      }

      if (ch === "'" || ch === '"') {
        inString = true;
        stringChar = ch;
        i++;
        continue;
      }

      if (ch === '`') {
        inTemplate = true;
        i++;
        continue;
      }

      if (ch === '{') {
        braceCount++;
      } else if (ch === '}') {
        braceCount--;
        if (braceCount === 0) {
          // Found the matching closing brace
          // Copy the content from startI to here (inclusive)
          result += content.slice(startI, i + 1);
          i++;

          // Skip whitespace
          while (i < content.length && /\s/.test(content[i])) {
            i++;
          }

          // Now we should be at ')'
          if (i < content.length && content[i] === ')') {
            result += ' satisfies ToolDefinition';
            i++;
          }
          break;
        }
      }

      i++;
    }
  }

  content = result;

  // 2. Transform imports
  // Pattern A: import {defineTool} from './ToolDefinition.js'
  //   → import type {ToolDefinition} from './ToolDefinition.js'
  content = content.replace(
    /import\s*\{\s*defineTool\s*\}\s*from\s*['"](\.\.?\/)+ToolDefinition\.js['"]/g,
    (match) => {
      const pathMatch = match.match(/from\s*['"](.+?)['"]/);
      const importPath = pathMatch ? pathMatch[1] : './ToolDefinition.js';
      return `import type {ToolDefinition} from '${importPath}'`;
    }
  );

  // Pattern B: import {defineTool, timeoutSchema} from './ToolDefinition.js'
  //   → import type {ToolDefinition} from './ToolDefinition.js'; import {timeoutSchema} from './ToolDefinition.js'
  //   Actually better: import {timeoutSchema} from './ToolDefinition.js'; import type {ToolDefinition} from './ToolDefinition.js'
  content = content.replace(
    /import\s*\{\s*defineTool\s*,\s*([^}]+)\}\s*from\s*['"](\.\.?\/)+ToolDefinition\.js['"]/g,
    (match, otherImports, ...rest) => {
      const pathMatch = match.match(/from\s*['"](.+?)['"]/);
      const importPath = pathMatch ? pathMatch[1] : './ToolDefinition.js';
      const cleanedOther = otherImports.trim();
      return `import type {ToolDefinition} from '${importPath}'\nimport {${cleanedOther}} from '${importPath}'`;
    }
  );

  // Pattern C: import {defineTool, type Context, type Response} from './ToolDefinition.js'
  //   → import type {ToolDefinition, Context, Response} from './ToolDefinition.js'
  content = content.replace(
    /import\s*\{\s*defineTool\s*,\s*([^}]+)\}\s*from\s*['"](\.\.?\/)+ToolDefinition\.js['"]/g,
    (match, otherImports) => {
      const pathMatch = match.match(/from\s*['"](.+?)['"]/);
      const importPath = pathMatch ? pathMatch[1] : './ToolDefinition.js';
      // Check if other imports are all type imports
      const cleanedOther = otherImports.replace(/\btype\s+/g, '').trim();
      // If all were type imports, merge into one type import
      if (otherImports.includes('type ')) {
        return `import type {ToolDefinition, ${cleanedOther}} from '${importPath}'`;
      }
      return `import type {ToolDefinition} from '${importPath}'\nimport {${cleanedOther}} from '${importPath}'`;
    }
  );

  // Pattern D: import {type Context, defineTool, type Response} - defineTool not first
  // Handle: import {type X, defineTool, ...} from
  content = content.replace(
    /import\s*\{([^}]*defineTool[^}]*)\}\s*from\s*['"](\.\.?\/)+ToolDefinition\.js['"]/g,
    (match, imports) => {
      const pathMatch = match.match(/from\s*['"](.+?)['"]/);
      const importPath = pathMatch ? pathMatch[1] : './ToolDefinition.js';

      // Parse imports
      const parts = imports.split(',').map(s => s.trim()).filter(Boolean);
      const typeImports = ['ToolDefinition']; // always add ToolDefinition
      const valueImports = [];

      for (const part of parts) {
        if (part === 'defineTool') continue;
        if (part.startsWith('type ')) {
          typeImports.push(part.replace('type ', '').trim());
        } else {
          valueImports.push(part);
        }
      }

      let result = `import type {${typeImports.join(', ')}} from '${importPath}'`;
      if (valueImports.length > 0) {
        result += `\nimport {${valueImports.join(', ')}} from '${importPath}'`;
      }
      return result;
    }
  );

  if (content !== originalContent) {
    writeFileSync(filePath, content, 'utf8');
    console.log(`  Updated: ${relative(process.cwd(), filePath)}`);
    return true;
  }

  return false;
}

const files = walkDir(TOOLS_DIR);
console.log(`Found ${files.length} tool files to process`);

let updated = 0;
for (const file of files) {
  if (transformFile(file)) {
    updated++;
  }
}

console.log(`\nUpdated ${updated} files`);
