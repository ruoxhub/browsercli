/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {Activity, Key, RefreshCw} from 'lucide-react';
import {useState} from 'react';

import {api} from '../../lib/api';
import type {RuntimeConfig} from '../../lib/protocol';

import {Field, inputClass} from './Field';

interface LlmSectionProps {
  config: RuntimeConfig | null;
  saving: boolean;
  /** 通知父级进入/退出保存中状态；Task 8 传 (v) => setSaving(v ? 'llm' : null)。
   *  缺了它 saving 恒为 false，「保存中...」是死代码。 */
  setSaving: (saving: boolean) => void;
  patchRoot: (patch: Partial<RuntimeConfig>) => void;
  onSaved: (config: RuntimeConfig) => void;
  onError: (message: string) => void;
}

export function LlmSection({
  config,
  saving,
  setSaving,
  patchRoot,
  onSaved,
  onError,
}: LlmSectionProps) {
  const [llmTest, setLlmTest] = useState<{ok: boolean; message: string} | null>(
    null,
  );
  const [models, setModels] = useState<
    Array<{id: string; object?: string; owned_by?: string}>
  >([]);
  const [loadingModels, setLoadingModels] = useState(false);

  const currentOpenai = config?.openai;

  const openaiPatch = (patch: Record<string, unknown>) => {
    patchRoot({openai: {...currentOpenai, ...patch}});
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const updated = await api.updateLlmConfig({
        llmProvider: config.llmProvider,
        openai: config.openai as Record<string, unknown>,
      });
      onSaved(updated);
    } catch (err) {
      onError(err instanceof Error ? err.message : '保存 LLM 配置失败');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!config) return;
    setLlmTest(null);
    setSaving(true);
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
      setSaving(false);
    }
  };

  const handleFetchModels = async () => {
    if (!config) return;
    setLoadingModels(true);
    try {
      const result = await api.listLlmModels({
        llmProvider: config.llmProvider,
        openai: config.openai as Record<string, unknown>,
      });
      setModels(result.models);
    } catch (err) {
      onError(err instanceof Error ? err.message : '获取模型列表失败');
    } finally {
      setLoadingModels(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Key
          className="text-[var(--color-accent)]"
          size={20}
        />
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
          LLM Provider
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Provider">
          <select
            value={config?.llmProvider ?? 'openai'}
            onChange={e =>
              patchRoot({
                llmProvider: e.target.value as RuntimeConfig['llmProvider'],
              })
            }
            className={inputClass}
          >
            <option value="openai">OpenAI</option>
          </select>
        </Field>

        <Field
          label="OpenAI API Key"
          hint="留空则不修改"
        >
          <input
            type="password"
            value={currentOpenai?.apiKey ?? ''}
            onChange={e => openaiPatch({apiKey: e.target.value})}
            placeholder="留空则不修改"
            className={`${inputClass} font-mono`}
          />
        </Field>

        <Field label="OpenAI Base URL">
          <input
            type="text"
            value={currentOpenai?.baseURL ?? ''}
            onChange={e => openaiPatch({baseURL: e.target.value})}
            placeholder="https://api.openai.com/v1"
            className={`${inputClass} font-mono`}
          />
        </Field>

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
            value={currentOpenai?.model ?? ''}
            onChange={e => openaiPatch({model: e.target.value})}
            className={`${inputClass} font-mono`}
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
            {currentOpenai?.model &&
              !models.some(m => m.id === currentOpenai.model) && (
                <option value={currentOpenai.model}>
                  {currentOpenai.model}
                </option>
              )}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 text-xs font-medium rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存本区配置'}
        </button>
        <button
          onClick={handleTest}
          disabled={saving}
          className="px-4 py-2 text-xs font-medium rounded-lg bg-[var(--color-accent)] text-[var(--color-bg-primary)] hover:opacity-90 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
        >
          <Activity size={12} />
          测试连接
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
    </div>
  );
}
