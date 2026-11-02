/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import type {
  Context,
  Extension,
  Response,
} from '../../../../src/tools/ToolDefinition.js';
import {
  installExtension,
  listExtensions,
  reloadExtension,
  triggerExtensionAction,
  uninstallExtension,
} from '../../../../src/tools/extensions/extensions.js';

interface MockResponseCapture {
  lines: string[];
  structuredContent: unknown;
  listExtensionsCalled: boolean;
  response: Response;
}

function createMockResponse(): MockResponseCapture {
  const capture: MockResponseCapture = {
    lines: [],
    structuredContent: null,
    listExtensionsCalled: false,
    response: {
      appendResponseLine(line: string) {
        capture.lines.push(line);
      },
      setStructuredContent(content: unknown) {
        capture.structuredContent = content;
      },
      setIncludePages() {
        void 0;
      },
      setIncludeNetworkRequests() {
        void 0;
      },
      setIncludeConsoleData() {
        void 0;
      },
      attachImage() {
        void 0;
      },
      attachNetworkRequest() {
        void 0;
      },
      attachConsoleMessage() {
        void 0;
      },
      setIncludeWebSocketConnections() {
        void 0;
      },
      attachWebSocket() {
        void 0;
      },
      setListExtensions() {
        capture.listExtensionsCalled = true;
      },
    },
  };
  return capture;
}

describe('extensions tools', () => {
  describe('install_extension', () => {
    it('installs an extension and appends response line', async () => {
      const capture = createMockResponse();
      let installedPath = '';
      const context = {
        installExtension: async (path: string) => {
          installedPath = path;
          return 'ext-123';
        },
      } as unknown as Context;

      await installExtension.handler(
        {params: {path: '/path/to/extension'}},
        capture.response,
        context,
      );

      assert.equal(installedPath, '/path/to/extension');
      assert.deepEqual(capture.lines, ['Extension installed. Id: ext-123']);
      assert.deepEqual(capture.structuredContent, {
        success: true,
        id: 'ext-123',
        message: 'Extension installed. Id: ext-123',
      });
    });
  });

  describe('uninstall_extension', () => {
    it('uninstalls an extension and appends response line', async () => {
      const capture = createMockResponse();
      let uninstalledId = '';
      const context = {
        uninstallExtension: async (id: string) => {
          uninstalledId = id;
        },
      } as unknown as Context;

      await uninstallExtension.handler(
        {params: {id: 'ext-123'}},
        capture.response,
        context,
      );

      assert.equal(uninstalledId, 'ext-123');
      assert.deepEqual(capture.lines, ['Extension uninstalled. Id: ext-123']);
      assert.deepEqual(capture.structuredContent, {
        success: true,
        id: 'ext-123',
        message: 'Extension uninstalled. Id: ext-123',
      });
    });
  });

  describe('list_extensions', () => {
    it('sets list extensions and formats empty list', async () => {
      const capture = createMockResponse();
      const context = {
        listExtensions: async () => new Map<string, Extension>(),
      } as unknown as Context;

      await listExtensions.handler({params: {}}, capture.response, context);

      assert.equal(capture.listExtensionsCalled, true);
      assert.deepEqual(capture.lines, [
        '## Extensions',
        'No extensions installed.',
      ]);
      assert.deepEqual(capture.structuredContent, {
        extensions: [],
      });
    });

    it('formats installed extensions list', async () => {
      const capture = createMockResponse();
      const extensions = new Map<string, Extension>([
        [
          'ext-1',
          {
            id: 'ext-1',
            name: 'Sample Ext',
            version: '1.2.3',
            enabled: true,
            path: '/path/ext1',
          },
        ],
        [
          'ext-2',
          {
            id: 'ext-2',
            name: 'Disabled Ext',
            version: '0.1.0',
            enabled: false,
            path: '/path/ext2',
          },
        ],
      ]);
      const context = {
        listExtensions: async () => extensions,
      } as unknown as Context;

      await listExtensions.handler({params: {}}, capture.response, context);

      assert.equal(capture.listExtensionsCalled, true);
      assert.deepEqual(capture.lines, [
        '## Extensions',
        'id=ext-1 "Sample Ext" v1.2.3 Enabled\nid=ext-2 "Disabled Ext" v0.1.0 Disabled',
      ]);
      assert.deepEqual(capture.structuredContent, {
        extensions: Array.from(extensions.values()),
      });
    });
  });

  describe('reload_extension', () => {
    it('reloads an extension by reinstalling its path', async () => {
      const capture = createMockResponse();
      let installedPath = '';
      const mockExt: Extension = {
        id: 'ext-123',
        name: 'Test Ext',
        version: '1.0.0',
        enabled: true,
        path: '/path/to/extension',
      };
      const context = {
        getExtension: async (id: string) =>
          id === 'ext-123' ? mockExt : undefined,
        installExtension: async (path: string) => {
          installedPath = path;
          return 'ext-123';
        },
      } as unknown as Context;

      await reloadExtension.handler(
        {params: {id: 'ext-123'}},
        capture.response,
        context,
      );

      assert.equal(installedPath, '/path/to/extension');
      assert.deepEqual(capture.lines, ['Extension reloaded.']);
      assert.deepEqual(capture.structuredContent, {
        success: true,
        id: 'ext-123',
        message: 'Extension reloaded.',
      });
    });

    it('throws when extension is not found', async () => {
      const capture = createMockResponse();
      const context = {
        getExtension: async () => undefined,
        installExtension: async () => 'ext-123',
      } as unknown as Context;

      await assert.rejects(
        async () => {
          await reloadExtension.handler(
            {params: {id: 'non-existent'}},
            capture.response,
            context,
          );
        },
        {message: 'Extension with ID non-existent not found.'},
      );
    });
  });

  describe('trigger_extension_action', () => {
    it('triggers extension action and appends response line', async () => {
      const capture = createMockResponse();
      let triggeredId = '';
      const context = {
        triggerExtensionAction: async (id: string) => {
          triggeredId = id;
        },
      } as unknown as Context;

      await triggerExtensionAction.handler(
        {params: {id: 'ext-123'}},
        capture.response,
        context,
      );

      assert.equal(triggeredId, 'ext-123');
      assert.deepEqual(capture.lines, [
        'Extension action triggered for ID ext-123',
      ]);
      assert.deepEqual(capture.structuredContent, {
        success: true,
        id: 'ext-123',
        message: 'Extension action triggered for ID ext-123',
      });
    });
  });
});
