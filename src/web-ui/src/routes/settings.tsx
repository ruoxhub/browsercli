/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  Activity,
  Gauge,
  Globe,
  RefreshCw,
  Settings,
  Shield,
} from 'lucide-react';
import {useEffect, useState} from 'react';

import {AntiDetectSection} from '../components/settings/AntiDetectSection';
import {BrowserSection} from '../components/settings/BrowserSection';
import {CollectionSection} from '../components/settings/CollectionSection';
import {GeneralSection} from '../components/settings/GeneralSection';
import {api} from '../lib/api';
import type {
  BrowserConfig,
  RuntimeConfig,
  WorkerFullStatus,
} from '../lib/protocol';
import {wsClient} from '../lib/ws';

type SectionKey = 'general' | 'browser' | 'anti-detect' | 'collection';

const NAV_ITEMS: Array<{
  key: SectionKey;
  label: string;
  icon: typeof Settings;
}> = [
  {key: 'general', label: '通用', icon: Settings},
  {key: 'browser', label: '浏览器连接', icon: Globe},
  {key: 'anti-detect', label: '反检测', icon: Shield},
  {key: 'collection', label: '采集与限制', icon: Gauge},
];

export default function SettingsPage() {
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [browserConnected, setBrowserConnected] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionKey>('general');

  const fetchConfig = async () => {
    try {
      setConfig(await api.getConfig());
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
    void fetchConfig();
    void fetchStatus();

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

  // 消除样板的关键：现状每个字段都手写一遍
  // setConfig(prev => ({...prev, browser: {...prev.browser, x: v}}))，
  // 5 个分区会让这段复制几十遍。
  const patchBrowser = (patch: Partial<BrowserConfig>) => {
    setConfig(prev =>
      prev ? {...prev, browser: {...(prev.browser ?? {}), ...patch}} : prev,
    );
  };

  // 三个 browser 分区（浏览器连接 / 反检测 / 采集限制）共用一个保存动作，
  // 但每个分区有自己的「保存中...」指示器 —— 用 key 区分，
  // 否则 saveBrowser 恒为 'browser'，反检测与采集分区的按钮永远不进 loading 态。
  const saveBrowser = async (key: string) => {
    if (!config?.browser) return;
    setSaving(key);
    try {
      setConfig(await api.updateBrowserConfig(config.browser));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(null);
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

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    setNotice(null);
    try {
      await Promise.all([fetchConfig(), fetchStatus()]);
    } finally {
      setRefreshing(false);
    }
  };

  const showNotice = (message: string) => {
    setError(null);
    setNotice(message);
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
    <div className="flex-1 flex flex-col p-6 lg:p-8 overflow-hidden select-none">
      <div className="border-b border-[var(--color-border-muted)] pb-6 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--color-text-primary)]">
              系统设置
            </h1>
            <p className="text-xs text-[var(--color-text-muted)] mt-1.5">
              配置浏览器连接、反检测与采集限制。保存后自动缓存到本地，下次启动服务时自动加载并连接。
            </p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50 shrink-0"
          >
            <RefreshCw
              size={12}
              className={refreshing ? 'animate-spin' : ''}
            />
            {refreshing ? '刷新中...' : '刷新配置'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-xs text-[var(--color-status-red)]">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 text-xs text-[var(--color-status-green)]">
          {notice}
        </div>
      )}

      <div className="flex gap-6 min-h-0 flex-1">
        {/* 左侧导航 */}
        <nav className="w-44 shrink-0 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map(item => {
            const Icon = item.icon;
            const isActive = activeSection === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setActiveSection(item.key)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-all text-left ${
                  isActive
                    ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-accent)] border border-[var(--color-border-default)]'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] border border-transparent'
                }`}
              >
                <Icon size={14} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* 右侧分区：导航切换时才渲染对应分区（懒挂载） */}
        <div className="flex-1 min-w-0 overflow-y-auto bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-xl p-6 shadow-lg shadow-black/25">
          {activeSection === 'general' && (
            <GeneralSection
              onReloadConfig={fetchConfig}
              onError={setError}
              onNotice={showNotice}
            />
          )}

          {activeSection === 'browser' && (
            <BrowserSection
              browser={config?.browser}
              connected={browserConnected}
              saving={saving === 'browser'}
              busy={
                saving === 'connect-browser' || saving === 'disconnect-browser'
              }
              patchBrowser={patchBrowser}
              onSave={() => saveBrowser('browser')}
              onConnect={handleConnectBrowser}
              onDisconnect={handleDisconnectBrowser}
            />
          )}

          {activeSection === 'anti-detect' && (
            <AntiDetectSection
              browser={config?.browser}
              saving={saving === 'anti-detect'}
              patchBrowser={patchBrowser}
              onSave={() => saveBrowser('anti-detect')}
            />
          )}

          {activeSection === 'collection' && (
            <CollectionSection
              browser={config?.browser}
              saving={saving === 'collection'}
              patchBrowser={patchBrowser}
              onSave={() => saveBrowser('collection')}
            />
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
        <Activity size={11} />
        <span>
          浏览器连接 · 反检测 · 采集三区共用同一份浏览器配置，
          任一区保存会一并提交当前浏览器配置。
        </span>
      </div>
    </div>
  );
}
