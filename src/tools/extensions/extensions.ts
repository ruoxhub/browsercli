/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const installExtension = defineTool({
  name: 'install_extension',
  description: 'Installs a Chrome extension from the given path.',
  annotations: {
    category: ToolCategory.EXTENSIONS,
    readOnlyHint: false,
  },
  schema: {
    path: zod
      .string()
      .describe('Absolute path to the unpacked extension folder.'),
  },
  handler: async (request, response, context) => {
    const {path} = request.params;
    const id = await context.installExtension(path);
    response.appendResponseLine(`Extension installed. Id: ${id}`);
    if (response.setStructuredContent) {
      response.setStructuredContent({
        success: true,
        id,
        message: `Extension installed. Id: ${id}`,
      });
    }
  },
});

export const uninstallExtension = defineTool({
  name: 'uninstall_extension',
  description: 'Uninstalls a Chrome extension by its ID.',
  annotations: {
    category: ToolCategory.EXTENSIONS,
    readOnlyHint: false,
  },
  schema: {
    id: zod.string().describe('ID of the extension to uninstall.'),
  },
  handler: async (request, response, context) => {
    const {id} = request.params;
    await context.uninstallExtension(id);
    response.appendResponseLine(`Extension uninstalled. Id: ${id}`);
    if (response.setStructuredContent) {
      response.setStructuredContent({
        success: true,
        id,
        message: `Extension uninstalled. Id: ${id}`,
      });
    }
  },
});

export const listExtensions = defineTool({
  name: 'list_extensions',
  description:
    'Lists all the Chrome extensions installed in the browser. This includes their name, ID, version, and enabled status.',
  annotations: {
    category: ToolCategory.EXTENSIONS,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (_request, response, context) => {
    if (response.setListExtensions) {
      response.setListExtensions();
    }
    const extensionsMap = await context.listExtensions?.();
    const extensionArray = extensionsMap
      ? Array.from(extensionsMap.values())
      : [];
    response.appendResponseLine('## Extensions');
    if (extensionArray.length === 0) {
      response.appendResponseLine('No extensions installed.');
    } else {
      const extensionsMessage = extensionArray
        .map(
          ext =>
            `id=${ext.id} "${ext.name}" v${ext.version} ${ext.enabled ? 'Enabled' : 'Disabled'}`,
        )
        .join('\n');
      response.appendResponseLine(extensionsMessage);
    }
    if (response.setStructuredContent) {
      response.setStructuredContent({
        extensions: extensionArray,
      });
    }
  },
});

export const reloadExtension = defineTool({
  name: 'reload_extension',
  description: 'Reloads an unpacked Chrome extension by its ID.',
  annotations: {
    category: ToolCategory.EXTENSIONS,
    readOnlyHint: false,
  },
  schema: {
    id: zod.string().describe('ID of the extension to reload.'),
  },
  handler: async (request, response, context) => {
    const {id} = request.params;
    const extension = await context.getExtension(id);
    if (!extension) {
      throw new Error(`Extension with ID ${id} not found.`);
    }
    await context.installExtension(extension.path);
    response.appendResponseLine('Extension reloaded.');
    if (response.setStructuredContent) {
      response.setStructuredContent({
        success: true,
        id,
        message: 'Extension reloaded.',
      });
    }
  },
});

export const triggerExtensionAction = defineTool({
  name: 'trigger_extension_action',
  description: 'Triggers the default action of an extension by its ID.',
  annotations: {
    category: ToolCategory.EXTENSIONS,
    readOnlyHint: false,
  },
  schema: {
    id: zod.string().describe('ID of the extension to trigger the action for.'),
  },
  handler: async (request, response, context) => {
    const {id} = request.params;
    await context.triggerExtensionAction(id);
    response.appendResponseLine(`Extension action triggered for ID ${id}`);
    if (response.setStructuredContent) {
      response.setStructuredContent({
        success: true,
        id,
        message: `Extension action triggered for ID ${id}`,
      });
    }
  },
});
