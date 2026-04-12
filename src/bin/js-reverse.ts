#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {runAxiCli, type AxiCliCommand} from 'axi-sdk-js';
import {createRequire} from 'node:module';
import type {DaemonContext} from '../cli/types.js';
import {
  startCommand,
  stopCommand,
  statusCommand,
  toolDispatcherCommand,
  callSkillCommand,
  listSkillsCommand,
  listToolsCommand,
  replCommand,
  scaffoldCommand,
  generateTopLevelHelp,
  generateCommandHelp,
} from '../cli/index.js';

const require = createRequire(import.meta.url);
const pkg = require('../../../package.json');

const homeHandler: AxiCliCommand<DaemonContext> = async () =>
  generateTopLevelHelp();

await runAxiCli<DaemonContext>({
  description: 'JS逆向工程MCP服务 — 标准化前端JavaScript逆向流程',
  version: pkg.version,
  topLevelHelp: generateTopLevelHelp(),
  home: homeHandler,
  hooks: false,
  getCommandHelp: cmd => generateCommandHelp(cmd),
  commands: {
    start: startCommand,
    stop: stopCommand,
    status: statusCommand,
    call: toolDispatcherCommand,
    'call-skill': callSkillCommand,
    'list-skills': listSkillsCommand,
    'list-tools': listToolsCommand,
    repl: replCommand,
    scaffold: scaffoldCommand,
  },
});
