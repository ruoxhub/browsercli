/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  Globe,
  Key,
  Database,
  Plug,
  PlugZap,
  Save,
  RefreshCw,
  Activity,
} from 'lucide-react';
import {useEffect, useState} from 'react';

import {api} from '../lib/api';
import type {RuntimeConfig, WorkerFullStatus} from '../lib/protocol';
import {wsClient} from '../lib/ws';

export default function SettingsPage() {
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [browserConnected, setBrowserConnected] = useState(false);
  const [llmTest, setLlmTest] = useState<{ok: boolean; message: string} | null>(
    null,
  );
  const [models, setModels] = useState<
    {id: string; object?: string; owned_by?: string}[]
  >([]);
  const [loadingModels, setLoadingModels] = useState(false);

  const fetchConfig = async () => {
    try {
      const data = await api.getConfig();
      setConfig(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取配置失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchStatus = async () => {
    try {
      const data = await api.getWorkerStatus();
      setBrowserConnected(data.browser?.connected ?? false);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchConfig();
    fetchStatus();

    const unsub = wsClient.subscribe('worker.status', msg => {
      if (msg.type === 'snapshot' || msg.type === 'event') {
        const payload = msg.payload as WorkerFullStatus;
        if (payload?.browser) {
          setBrowserConnected(payload.browser.connected);
        }
      }
    });

    return () => unsub();
  }, []);

  const handleSaveBrowser = async () => {
    if (!config?.browser) return;
    setSaving('browser');
    try {
      const updated = await api.updateBrowserConfig(config.browser);
      setConfig(updated);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(null);
    }
  };

  const handleSaveLlm = async () => {
    if (!config) return;
    setSaving('llm');
    try {
      const updated = await api.updateLlmConfig({
        llmProvider: config.llmProvider,
        openai: config.openai as Record<string, unknown>,
      });
      setConfig(updated);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(null);
    }
  };

  const handleSaveDatabase = async () => {
    if (!config?.databaseUrl) return;
    setSaving('database');
    try {
      await api.updateDatabaseConfig(config.databaseUrl);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(null);
    }
  };

  const handleTestLlm = async () => {
    if (!config) return;
    setSaving('test-llm');
    setLlmTest(null);
    try {
      const result = await api.testLlmConfig({
        llmProvider: config.llmProvider,
        openai: config.openai as Record<string, unknown>,
      });
      setLlmTest({
        ok: result.ok,
        message: result.ok
          ? `连接成功（${result.provider}，${result.latencyMs}ms）`
          : '连接失败',
      });
    } catch (err) {
      setLlmTest({
        ok: false,
        message: err instanceof Error ? err.message : '连接测试失败',
      });
    } finally {
      setSaving(null);
    }
  };

  const handleFetchModels = async () => {
    if (!config) return;
    setLoadingModels(true);
    setError(null);
    try {
      const result = await api.listLlmModels({
        llmProvider: config.llmProvider,
        openai: config.openai as Record<string, unknown>,
      });
      setModels(result.models);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取模型列表失败');
    } finally {
      setLoadingModels(false);
    }
  };

  const handleConnectBrowser = async () => {
    setSaving('connect-browser');
    try {
      await api.connectBrowser();
      await fetchStatus();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '连接浏览器失败');
    } finally {
      setSaving(null);
    }
  };

  const handleDisconnectBrowser = async () => {
    setSaving('disconnect-browser');
    try {
      await api.disconnectBrowser();
      setBrowserConnected(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '断开失败');
    } finally {
      setSaving(null);
    }
  };

  const handleConnectDatabase = async () => {
    setSaving('connect-database');
    try {
      await api.connectDatabase();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '连接数据库失败');
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 p-6 lg:p-8 space-y-6 animate-pulse">
        <div className="h-10 w-48 bg-[var(--color-border-muted)] rounded-lg mb-8" />
        <div className="h-64 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-xl" />
      </div>
    );
  }

  return (
    <div className="flex-1 p-6 lg:p-8 overflow-y-auto space-y-8 select-none">
      <div className="border-b border-[var(--color-border-muted)] pb-6">
        <h1 className="text-xl font-bold tracking-tight text-[var(--color-text-primary)]">
          连接设置
        </h1>
        <p className="text-xs text-[var(--color-text-muted)] mt-1.5">
          配置浏览器连接、LLM Provider
          和数据库。配置仅存于内存，重启后回落到环境变量种子值。
        </p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-xs text-[var(--color-status-red)]">
          {error}
        </div>
      )}

      {/* 浏览器连接区块 */}
      <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-xl p-6 shadow-lg shadow-black/25">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Globe
              className={
                browserConnected
                  ? 'text-[var(--color-status-green)]'
                  : 'text-[var(--color-text-muted)]'
              }
              size={20}
            />
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
              浏览器连接
            </h2>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
              browserConnected
                ? 'bg-emerald-500/10 text-[var(--color-status-green)] border-emerald-500/20'
                : 'bg-zinc-500/10 text-[var(--color-text-muted)] border-zinc-500/20'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${browserConnected ? 'bg-[var(--color-status-green)]' : 'bg-[var(--color-text-muted)]'}`}
            />
            {browserConnected ? '已连接' : '未连接'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--color-text-secondary)]">
              Headless
            </span>
            <select
              value={config?.browser?.headless ? 'true' : 'false'}
              onChange={e =>
                setConfig(prev =>
                  prev
                    ? {
                        ...prev,
                        browser: {
                          ...(prev.browser ?? {}),
                          headless: e.target.value === 'true',
                        },
                      }
                    : prev,
                )
              }
              className="bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded-lg px-3 py-2 text-xs text-[var(--color-text-primary)]"
            >
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--color-text-secondary)]">
              Channel
            </span>
            <select
              value={config?.browser?.channel ?? ''}
              onChange={e =>
                setConfig(prev =>
                  prev
                    ? {
                        ...prev,
                        browser: {
                          ...(prev.browser ?? {}),
                          channel: e.target.value,
                        },
                      }
                    : prev,
                )
              }
              className="bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded-lg px-3 py-2 text-xs text-[var(--color-text-primary)]"
            >
              <option value="">默认（内置浏览器）</option>
              <option value="stable">stable</option>
              <option value="beta">beta</option>
              <option value="dev">dev</option>
              <option value="canary">canary</option>
              <option value="chromium">chromium</option>
              <option value="bidi-chromium">bidi-chromium</option>
              <option value="bidi-chrome">bidi-chrome</option>
              <option value="bidi-chrome-beta">bidi-chrome-beta</option>
              <option value="bidi-chrome-dev">bidi-chrome-dev</option>
              <option value="bidi-chrome-canary">bidi-chrome-canary</option>
              <option value="firefox">firefox</option>
              <option value="moz-firefox">moz-firefox</option>
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--color-text-secondary)]">
              Browser URL
            </span>
            <input
              type="text"
              value={config?.browser?.browserURL ?? ''}
              onChange={e =>
                setConfig(prev =>
                  prev
                    ? {
                        ...prev,
                        browser: {
                          ...(prev.browser ?? {}),
                          browserURL: e.target.value,
                        },
                      }
                    : prev,
                )
              }
              placeholder="http://127.0.0.1:9222"
              className="bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded-lg px-3 py-2 text-xs text-[var(--color-text-primary)] font-mono"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--color-text-secondary)]">
              WS Endpoint
            </span>
            <input
              type="text"
              value={config?.browser?.wsEndpoint ?? ''}
              onChange={e =>
                setConfig(prev =>
                  prev
                    ? {
                        ...prev,
                        browser: {
                          ...(prev.browser ?? {}),
                          wsEndpoint: e.target.value,
                        },
                      }
                    : prev,
                )
              }
              placeholder="ws://127.0.0.1:9222/devtools/browser/..."
              className="bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded-lg px-3 py-2 text-xs text-[var(--color-text-primary)] font-mono"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--color-text-secondary)]">
              Executable Path
            </span>
            <input
              type="text"
              value={config?.browser?.executablePath ?? ''}
              onChange={e =>
                setConfig(prev =>
                  prev
                    ? {
                        ...prev,
                        browser: {
                          ...(prev.browser ?? {}),
                          executablePath: e.target.value,
                        },
                      }
                    : prev,
                )
              }
              placeholder="/path/to/chrome"
              className="bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded-lg px-3 py-2 text-xs text-[var(--color-text-primary)] font-mono"
            />
          </label>

          <label className="flex items-center gap-2 mt-6">
            <input
              type="checkbox"
              checked={config?.browser?.isolated ?? true}
              onChange={e =>
                setConfig(prev =>
                  prev
                    ? {
                        ...prev,
                        browser: {
                          ...(prev.browser ?? {}),
                          isolated: e.target.checked,
                        },
                      }
                    : prev,
                )
              }
              className="accent-[var(--color-accent)]"
            />
            <span className="text-xs text-[var(--color-text-secondary)]">
              Isolated Context
            </span>
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSaveBrowser}
            disabled={saving === 'browser'}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
          >
            <Save size={12} />
            {saving === 'browser' ? '保存中...' : '保存配置'}
          </button>
          {browserConnected ? (
            <button
              onClick={handleDisconnectBrowser}
              disabled={saving === 'disconnect-browser'}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-red-500/10 border border-red-500/20 text-[var(--color-status-red)] hover:bg-red-500/20 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
            >
              <PlugZap size={12} />
              {saving === 'disconnect-browser' ? '断开中...' : '断开连接'}
            </button>
          ) : (
            <button
              onClick={handleConnectBrowser}
              disabled={saving === 'connect-browser'}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-[var(--color-accent)] text-[var(--color-bg-primary)] hover:opacity-90 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
            >
              <Plug size={12} />
              {saving === 'connect-browser' ? '连接中...' : '连接浏览器'}
            </button>
          )}
        </div>
      </div>

      {/* LLM Provider 区块 */}
      <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-xl p-6 shadow-lg shadow-black/25">
        <div className="flex items-center gap-3 mb-6">
          <Key
            className="text-[var(--color-accent)]"
            size={20}
          />
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
            LLM Provider
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--color-text-secondary)]">
              Provider
            </span>
            <select
              value={config?.llmProvider ?? 'openai'}
              onChange={e =>
                setConfig(prev =>
                  prev
                    ? {
                        ...prev,
                        llmProvider: e.target
                          .value as RuntimeConfig['llmProvider'],
                      }
                    : prev,
                )
              }
              className="bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded-lg px-3 py-2 text-xs text-[var(--color-text-primary)]"
            >
              <option value="openai">OpenAI</option>
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--color-text-secondary)]">
              OpenAI API Key
            </span>
            <input
              type="password"
              value={config?.openai?.apiKey ?? ''}
              onChange={e =>
                setConfig(prev =>
                  prev
                    ? {
                        ...prev,
                        openai: {...prev.openai, apiKey: e.target.value},
                      }
                    : prev,
                )
              }
              placeholder="留空则不修改"
              className="bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded-lg px-3 py-2 text-xs text-[var(--color-text-primary)] font-mono"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--color-text-secondary)]">
              OpenAI Base URL
            </span>
            <input
              type="text"
              value={config?.openai?.baseURL ?? ''}
              onChange={e =>
                setConfig(prev =>
                  prev
                    ? {
                        ...prev,
                        openai: {...prev.openai, baseURL: e.target.value},
                      }
                    : prev,
                )
              }
              placeholder="https://api.openai.com/v1"
              className="bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded-lg px-3 py-2 text-xs text-[var(--color-text-primary)] font-mono"
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--color-text-secondary)]">
                OpenAI Model
              </span>
              <button
                type="button"
                onClick={handleFetchModels}
                disabled={loadingModels}
                className="text-xs text-[var(--color-accent)] hover:opacity-80 disabled:opacity-50 flex items-center gap-1 transition-opacity"
              >
                <RefreshCw
                  size={12}
                  className={loadingModels ? 'animate-spin' : ''}
                />
                {loadingModels ? '获取中...' : '获取模型列表'}
              </button>
            </div>
            <select
              value={config?.openai?.model ?? ''}
              onChange={e =>
                setConfig(prev =>
                  prev
                    ? {
                        ...prev,
                        openai: {...prev.openai, model: e.target.value},
                      }
                    : prev,
                )
              }
              className="bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded-lg px-3 py-2 text-xs text-[var(--color-text-primary)] font-mono"
            >
              <option value="">请选择模型</option>
              {models.map(m => (
                <option
                  key={m.id}
                  value={m.id}
                >
                  {m.id}
                </option>
              ))}
              {config?.openai?.model &&
                !models.some(m => m.id === config.openai!.model) && (
                  <option value={config.openai.model}>
                    {config.openai.model}
                  </option>
                )}
            </select>
          </div>
        </div>

        <button
          onClick={handleSaveLlm}
          disabled={saving === 'llm'}
          className="px-4 py-2 text-xs font-medium rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
        >
          <Save size={12} />
          {saving === 'llm' ? '保存中...' : '保存 LLM 配置'}
        </button>
        <button
          onClick={handleTestLlm}
          disabled={saving === 'test-llm'}
          className="px-4 py-2 text-xs font-medium rounded-lg bg-[var(--color-accent)] text-[var(--color-bg-primary)] hover:opacity-90 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
        >
          <Activity size={12} />
          {saving === 'test-llm' ? '测试中...' : '测试连接'}
        </button>
        {llmTest && (
          <span
            className={`text-xs ${
              llmTest.ok
                ? 'text-[var(--color-status-green)]'
                : 'text-[var(--color-status-red)]'
            }`}
          >
            {llmTest.message}
          </span>
        )}
      </div>

      {/* 数据库区块 */}
      <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-xl p-6 shadow-lg shadow-black/25">
        <div className="flex items-center gap-3 mb-6">
          <Database
            className="text-[var(--color-accent)]"
            size={20}
          />
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
            数据库
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-4 mb-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--color-text-secondary)]">
              Database URL
            </span>
            <input
              type="text"
              value={config?.databaseUrl ?? ''}
              onChange={e =>
                setConfig(prev =>
                  prev ? {...prev, databaseUrl: e.target.value} : prev,
                )
              }
              placeholder="postgres://user:pass@localhost:5432/dbname"
              className="bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded-lg px-3 py-2 text-xs text-[var(--color-text-primary)] font-mono"
            />
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSaveDatabase}
            disabled={saving === 'database'}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
          >
            <Save size={12} />
            {saving === 'database' ? '保存中...' : '保存配置'}
          </button>
          <button
            onClick={handleConnectDatabase}
            disabled={saving === 'connect-database'}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-[var(--color-accent)] text-[var(--color-bg-primary)] hover:opacity-90 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
          >
            <Plug size={12} />
            {saving === 'connect-database' ? '连接中...' : '连接数据库'}
          </button>
        </div>
      </div>

      <button
        onClick={() => {
          fetchConfig();
          fetchStatus();
        }}
        className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] active:scale-95 transition-all flex items-center gap-2"
      >
        <RefreshCw size={12} />
        刷新配置
      </button>
    </div>
  );
}
