#!/usr/bin/env node
/**
 * AI 服务连通性验证脚本
 *
 * 验证链路：config.json → getAIConfig() → createAIService() → chat()
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Step 1: 读取 config.json ──────────────────────────────────────
console.log('=== Step 1: 读取 config.json ===');

let config;
try {
  const raw = readFileSync(resolve(ROOT, 'config.json'), 'utf-8');
  config = JSON.parse(raw);
  console.log('✅ config.json 加载成功');
} catch (e) {
  console.error('❌ config.json 加载失败:', e.message);
  process.exit(1);
}

console.log(`   llmProvider: ${config.llmProvider}`);
console.log(`   openai.baseURL: ${config.openai?.baseURL}`);
console.log(`   openai.model: ${config.openai?.model}`);
console.log(`   openai.apiKey: ${config.openai?.apiKey ? '***' + config.openai.apiKey.slice(-6) : '(未设置)'}`);

// ── Step 2: 验证配置字段完整性 ────────────────────────────────────
console.log('\n=== Step 2: 验证配置字段完整性 ===');

const errors = [];
if (!config.llmProvider) errors.push('缺少 llmProvider');
if (!config.openai?.apiKey) errors.push('缺少 openai.apiKey');
if (!config.openai?.baseURL) errors.push('缺少 openai.baseURL (可选但建议设置)');
if (!config.openai?.model) errors.push('缺少 openai.model (可选，将使用默认值)');

if (errors.length > 0 && errors.some(e => !e.includes('可选'))) {
  console.error('❌ 配置不完整:', errors.join('; '));
  process.exit(1);
}
if (errors.length > 0) {
  console.warn('⚠️  配置提示:', errors.join('; '));
} else {
  console.log('✅ 配置字段完整');
}

// ── Step 3: 测试 OpenAI API 连通性 ────────────────────────────────
console.log('\n=== Step 3: 测试 OpenAI API 连通性 ===');

const baseURL = config.openai.baseURL || 'https://api.openai.com/v1';
const model = config.openai.model || 'gpt-4o';
const apiKey = config.openai.apiKey;

try {
  const url = new URL('/v1/models', baseURL.replace(/\/v1\/?$/, ''));
  console.log(`   请求: GET ${url.origin}/v1/models`);

  const res = await fetch(`${url.origin}/v1/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(10000),
  });

  if (res.ok) {
    const data = await res.json();
    const modelList = data.data?.map(m => m.id) || [];
    const targetModelExists = modelList.includes(model);
    console.log(`✅ API 连通正常 (${res.status})`);
    console.log(`   可用模型数量: ${modelList.length}`);
    if (targetModelExists) {
      console.log(`✅ 目标模型 "${model}" 存在`);
    } else {
      console.warn(`⚠️  目标模型 "${model}" 未在模型列表中找到`);
      console.log(`   部分可用模型: ${modelList.slice(0, 10).join(', ')}${modelList.length > 10 ? '...' : ''}`);
    }
  } else {
    const body = await res.text().catch(() => '');
    console.error(`❌ API 返回错误 (${res.status}): ${body.slice(0, 200)}`);
  }
} catch (e) {
  if (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND') {
    console.error(`❌ 无法连接到 ${baseURL} — 服务未启动或地址错误`);
  } else if (e.name === 'TimeoutError' || e.name === 'AbortError') {
    console.error(`❌ 连接超时 — ${baseURL} 无响应 (10s)`);
  } else {
    console.error(`❌ 连接失败:`, e.message);
  }
}

// ── Step 4: 测试 Chat 接口 ────────────────────────────────────────
console.log('\n=== Step 4: 测试 Chat Completions 接口 ===');

try {
  const chatURL = new URL('/v1/chat/completions', baseURL.replace(/\/v1\/?$/, ''));
  console.log(`   请求: POST ${chatURL.origin}/v1/chat/completions`);

  const res = await fetch(`${chatURL.origin}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'Hi, reply with "OK" only.' }],
      max_tokens: 10,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (res.ok) {
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '(空)';
    const usage = data.usage;
    console.log(`✅ Chat 请求成功 (${res.status})`);
    console.log(`   模型响应: "${content}"`);
    if (usage) {
      console.log(`   Token 用量: prompt=${usage.prompt_tokens}, completion=${usage.completion_tokens}, total=${usage.total_tokens}`);
    }
  } else {
    const body = await res.text().catch(() => '');
    console.error(`❌ Chat 请求失败 (${res.status}): ${body.slice(0, 300)}`);
  }
} catch (e) {
  if (e.name === 'TimeoutError' || e.name === 'AbortError') {
    console.error('❌ Chat 请求超时 (30s)');
  } else {
    console.error('❌ Chat 请求失败:', e.message);
  }
}

console.log('\n=== 验证完成 ===');
