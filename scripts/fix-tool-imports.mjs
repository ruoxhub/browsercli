#!/usr/bin/env node
/**
 * Fix duplicate ToolDefinition imports - merge them into single import lines.
 */
import {readFileSync, writeFileSync, readdirSync, statSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = join(__dirname, '..', 'src', 'tools');

function walkDir(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...walkDir(fullPath));
    } else if (entry.endsWith('.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

function fixFile(filePath) {
  let content = readFileSync(filePath, 'utf8');
  const originalContent = content;

  if (!content.includes('ToolDefinition.js')) {
    return false;
  }

  // Find all import lines from ToolDefinition.js
  const lines = content.split('\n');
  const toolDefImportIndices = [];
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("from './ToolDefinition.js'") || 
        lines[i].includes('from "./ToolDefinition.js"') ||
        lines[i].includes("from '../ToolDefinition.js'") ||
        lines[i].includes('from "../ToolDefinition.js"')) {
      toolDefImportIndices.push(i);
    }
  }

  if (toolDefImportIndices.length <= 1) {
    // Just fix missing semicolons
    for (const idx of toolDefImportIndices) {
      if (!lines[idx].trimEnd().endsWith(';')) {
        lines[idx] = lines[idx].trimEnd() + ';';
      }
    }
    content = lines.join('\n');
    if (content !== originalContent) {
      writeFileSync(filePath, content, 'utf8');
      return true;
    }
    return false;
  }

  // Multiple imports from ToolDefinition.js - merge them
  const importPath = lines[toolDefImportIndices[0]].match(/from\s+['"]([^'"]+)['"]/)?.[1];
  
  const typeImports = [];
  const valueImports = [];

  for (const idx of toolDefImportIndices) {
    const line = lines[idx].trim();
    const isTypeImport = line.startsWith('import type ');
    const importMatch = line.match(/\{([^}]+)\}/);
    if (!importMatch) continue;

    const items = importMatch[1].split(',').map(s => {
      // Remove 'type' prefix from inline type imports
      return s.trim().replace(/\btype\s+/, '').trim();
    }).filter(Boolean);

    if (isTypeImport || line.includes('{type ')) {
      typeImports.push(...items);
    } else {
      // Check if items have inline type prefix
      for (const item of importMatch[1].split(',')) {
        const trimmed = item.trim();
        if (trimmed.startsWith('type ')) {
          typeImports.push(trimmed.replace('type ', ''));
        } else {
          valueImports.push(trimmed);
        }
      }
    }
  }

  // Deduplicate
  const uniqueTypes = [...new Set(typeImports)];
  const uniqueValues = [...new Set(valueImports)];

  // Build new import lines
  const newLines = [];
  if (uniqueTypes.length > 0) {
    newLines.push(`import type {${uniqueTypes.join(', ')}} from '${importPath}';`);
  }
  if (uniqueValues.length > 0) {
    newLines.push(`import {${uniqueValues.join(', ')}} from '${importPath}';`);
  }

  // Replace the first import line with new lines, remove the rest
  const firstIdx = toolDefImportIndices[0];
  lines[firstIdx] = newLines.join('\n');
  
  // Remove other import lines (in reverse order to preserve indices)
  for (let i = toolDefImportIndices.length - 1; i > 0; i--) {
    lines.splice(toolDefImportIndices[i], 1);
  }

  content = lines.join('\n');
  if (content !== originalContent) {
    writeFileSync(filePath, content, 'utf8');
    return true;
  }
  return false;
}

const files = walkDir(TOOLS_DIR);
let updated = 0;
for (const file of files) {
  if (fixFile(file)) {
    console.log(`  Fixed: ${file}`);
    updated++;
  }
}
console.log(`\nFixed ${updated} files`);
