/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 测试新迁移的 input 和 emulation 工具
 */

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['build/src/index.js'],
});

const client = new Client({
  name: 'test-client',
  version: '1.0.0',
});

async function runTests() {
  console.log('=== 开始测试新迁移的工具功能 ===\n');

  // 连接到服务器
  await client.connect(transport);
  console.log('✓ 已连接到 MCP 服务器\n');

  // 列出所有可用工具
  const tools = await client.listTools();
  const newTools = tools.tools.filter(t =>
    [
      'click',
      'hover',
      'fill',
      'drag',
      'fill_form',
      'upload_file',
      'press_key',
      'emulate_network',
      'emulate_cpu',
      'resize_page',
      'handle_dialog',
    ].includes(t.name),
  );

  console.log('=== 新迁移的工具列表 ===');
  for (const tool of newTools) {
    console.log(`  - ${tool.name}: ${tool.description?.slice(0, 60)}...`);
  }
  console.log(`\n共 ${newTools.length} 个新工具\n`);

  // 测试 1: 导航到百度
  console.log('=== 测试 1: 导航到百度 ===');
  try {
    await client.callTool({
      name: 'navigate_page',
      arguments: {url: 'https://www.baidu.com', timeout: 10000},
    });
    console.log('✓ 成功导航到百度首页\n');
  } catch (err) {
    console.log(`✗ 导航失败：${err.message}\n`);
  }

  // 等待页面加载
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 测试 2: 获取 DOM 结构查找搜索框
  console.log('=== 测试 2: 查找搜索框 ===');
  try {
    const result = await client.callTool({
      name: 'query_dom',
      arguments: {selector: '#kw', all: false},
    });
    console.log('✓ 找到搜索框 #kw');
    console.log(JSON.stringify(result, null, 2).slice(0, 500));
  } catch (err) {
    console.log(`✗ 查找失败：${err.message}`);
  }

  // 测试 3: 填充搜索框
  console.log('\n=== 测试 3: fill 工具 - 填充搜索词 ===');
  try {
    await client.callTool({
      name: 'fill',
      arguments: {selector: '#kw', value: 'MCP 服务器测试'},
    });
    console.log('✓ 成功填充搜索词\n');
  } catch (err) {
    console.log(`✗ 填充失败：${err.message}\n`);
  }

  // 测试 4: 调整窗口尺寸
  console.log('=== 测试 4: resize_page 工具 - 调整窗口尺寸 ===');
  try {
    await client.callTool({
      name: 'resize_page',
      arguments: {width: 1280, height: 720},
    });
    console.log('✓ 成功调整窗口尺寸为 1280x720\n');
  } catch (err) {
    console.log(`✗ 调整失败：${err.message}\n`);
  }

  // 测试 5: 网络节流仿真
  console.log('=== 测试 5: emulate_network 工具 - 网络节流 ===');
  try {
    await client.callTool({
      name: 'emulate_network',
      arguments: {throttlingOption: 'Fast 4G'},
    });
    console.log('✓ 成功设置网络仿真为 Fast 4G\n');
  } catch (err) {
    console.log(`✗ 网络仿真失败：${err.message}\n`);
  }

  // 测试 6: 点击搜索按钮
  console.log('=== 测试 6: click 工具 - 点击搜索按钮 ===');
  try {
    await client.callTool({
      name: 'click',
      arguments: {selector: '#su'},
    });
    console.log('✓ 成功点击搜索按钮\n');
  } catch (err) {
    console.log(`✗ 点击失败：${err.message}\n`);
  }

  // 等待搜索结果
  await new Promise(resolve => setTimeout(resolve, 3000));

  // 测试 7: 键盘按键测试 (返回上一页)
  console.log('=== 测试 7: press_key 工具 - Alt+Left 返回 ===');
  try {
    await client.callTool({
      name: 'press_key',
      arguments: {key: 'Alt+Left'},
    });
    console.log('✓ 成功按下 Alt+Left 返回\n');
  } catch (err) {
    console.log(`✗ 按键失败：${err.message}\n`);
  }

  // 测试 8: 悬停交互
  console.log('=== 测试 8: hover 工具 - 悬停搜索框 ===');
  try {
    await client.callTool({
      name: 'hover',
      arguments: {selector: '#kw'},
    });
    console.log('✓ 成功悬停在搜索框上\n');
  } catch (err) {
    console.log(`✗ 悬停失败：${err.message}\n`);
  }

  // 测试 9: 批量填充表单
  console.log('=== 测试 9: fill_form 工具 - 批量填充 ===');
  try {
    // 先导航到一个有表单的页面
    await client.callTool({
      name: 'navigate_page',
      arguments: {url: 'https://httpbin.org/forms/post', timeout: 10000},
    });
    await new Promise(resolve => setTimeout(resolve, 2000));

    await client.callTool({
      name: 'fill_form',
      arguments: {
        elements: [
          {selector: 'input[name="custname"]', value: '测试用户'},
          {selector: 'input[name="custtel"]', value: '123456789'},
        ],
      },
    });
    console.log('✓ 成功批量填充表单\n');
  } catch (err) {
    console.log(`✗ 批量填充失败：${err.message}\n`);
  }

  // 测试 10: CPU 节流
  console.log('=== 测试 10: emulate_cpu 工具 - CPU 节流 ===');
  try {
    await client.callTool({
      name: 'emulate_cpu',
      arguments: {throttlingRate: 2},
    });
    console.log('✓ 成功设置 CPU 节流为 2x\n');
  } catch (err) {
    console.log(`✗ CPU 节流失败：${err.message}\n`);
  }

  // 禁用所有仿真
  console.log('=== 禁用所有仿真 ===');
  try {
    await client.callTool({
      name: 'emulate_network',
      arguments: {throttlingOption: 'No emulation'},
    });
    await client.callTool({
      name: 'emulate_cpu',
      arguments: {throttlingRate: 1},
    });
    console.log('✓ 已禁用所有仿真\n');
  } catch (err) {
    console.log(`✗ 禁用失败：${err.message}\n`);
  }

  console.log('=== 测试完成 ===');
  process.exit(0);
}

runTests().catch(err => {
  console.error('测试执行错误:', err);
  process.exit(1);
});
