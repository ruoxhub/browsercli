/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  Check,
  Copy,
  Download,
  FileCode,
  Globe,
  Info,
  Layers,
  Shield,
  Smartphone,
  Terminal,
  X,
} from 'lucide-react';
import React, {useEffect, useState} from 'react';

import {api} from '../../lib/api';
import {useProxyStore} from '../../stores/proxy';

interface CaCertModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type OsTab = 'windows' | 'macos' | 'android' | 'ios';

export const CaCertModal: React.FC<CaCertModalProps> = ({isOpen, onClose}) => {
  const status = useProxyStore(state => state.status);
  const [ips, setIps] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<OsTab>('windows');
  const [copiedIp, setCopiedIp] = useState<string | null>(null);
  const [loadingIps, setLoadingIps] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    let mounted = true;
    setLoadingIps(true);
    api
      .getProxyLocalIps()
      .then(res => {
        if (mounted) {
          setIps(res.ips || []);
        }
      })
      .catch(err => {
        console.error('Failed to load local IPs:', err);
      })
      .finally(() => {
        if (mounted) {
          setLoadingIps(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const currentPort = status?.port ?? 8888;

  const copyToClipboard = (text: string, id: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedIp(id);
    setTimeout(() => setCopiedIp(null), 2000);
  };

  const handleDownload = (format: 'pem' | 'der') => {
    const url = `/api/proxy/ca/download?format=${format}`;
    const link = document.createElement('a');
    link.href = url;
    link.download = `mitm-ca.${format}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
      <div
        className="w-full max-w-2xl bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border-default)] bg-[var(--color-bg-tertiary)]/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Shield size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-[var(--color-text-primary)] flex items-center gap-2">
                CA 根证书与设备代理设置
              </h2>
              <p className="text-xs text-[var(--color-text-secondary)]">
                HTTPS 解密拦截需在被测设备上安装并信任根证书
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Certificate Download Section */}
          <div className="p-4 rounded-xl bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileCode
                  size={16}
                  className="text-[var(--color-accent)]"
                />
                <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                  下载 MITM 根证书
                </span>
              </div>
              <span className="text-xs font-mono text-[var(--color-text-muted)]">
                {status?.caInitialized ? '已生成证书' : '未初始化'}
              </span>
            </div>

            <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
              证书支持标准 PEM（文本，适用于大部分系统与开发环境）与
              DER（二进制，适用于 iOS / Android 手机导入）。
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                onClick={() => handleDownload('pem')}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-accent)]/15 border border-[var(--color-accent)]/30 text-[var(--color-accent)] text-xs font-medium hover:bg-[var(--color-accent)]/25 transition-all shadow-sm"
              >
                <Download size={14} />
                <span>下载 PEM 证书 (.pem / .crt)</span>
              </button>
              <button
                onClick={() => handleDownload('der')}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] text-xs font-medium hover:bg-[var(--color-bg-secondary)] transition-all"
              >
                <Download size={14} />
                <span>下载 DER 证书 (.der / .cer)</span>
              </button>
            </div>
          </div>

          {/* Local IP & Proxy address Section */}
          <div className="p-4 rounded-xl bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe
                  size={16}
                  className="text-emerald-400"
                />
                <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                  局域网代理地址（外部设备连接）
                </span>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                Port: {currentPort}
              </span>
            </div>

            <p className="text-xs text-[var(--color-text-secondary)]">
              手机或其它设备连接同一局域网 WiFi，在 WiFi 高级设置中配置 HTTP
              代理服务器与端口：
            </p>

            <div className="space-y-2">
              {loadingIps ? (
                <div className="text-xs text-[var(--color-text-muted)] py-2">
                  正在获取局域网 IP...
                </div>
              ) : ips.length === 0 ? (
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] font-mono text-xs text-[var(--color-text-secondary)]">
                  <span>127.0.0.1:{currentPort}</span>
                  <button
                    onClick={() =>
                      copyToClipboard(`127.0.0.1:${currentPort}`, 'local')
                    }
                    className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                  >
                    {copiedIp === 'local' ? (
                      <Check
                        size={14}
                        className="text-emerald-400"
                      />
                    ) : (
                      <Copy size={14} />
                    )}
                  </button>
                </div>
              ) : (
                ips.map(ip => {
                  const proxyStr = `${ip}:${currentPort}`;
                  const isCopied = copiedIp === ip;
                  return (
                    <div
                      key={ip}
                      className="flex items-center justify-between p-2.5 rounded-lg bg-[var(--color-bg-tertiary)]/70 border border-[var(--color-border-default)] font-mono text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[var(--color-text-primary)] font-bold">
                          {ip}
                        </span>
                        <span className="text-[var(--color-text-muted)]">
                          :{currentPort}
                        </span>
                      </div>
                      <button
                        onClick={() => copyToClipboard(proxyStr, ip)}
                        className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-accent)] transition-all"
                      >
                        {isCopied ? (
                          <>
                            <Check
                              size={12}
                              className="text-emerald-400"
                            />
                            <span className="text-emerald-400">已复制</span>
                          </>
                        ) : (
                          <>
                            <Copy size={12} />
                            <span>复制地址</span>
                          </>
                        )}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Installation Instructions by Platform */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
              <Layers
                size={16}
                className="text-purple-400"
              />
              <span>根证书安装与信任指引</span>
            </div>

            {/* Platform Tabs */}
            <div className="flex border-b border-[var(--color-border-default)] gap-1">
              <button
                onClick={() => setActiveTab('windows')}
                className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium border-b-2 transition-all ${
                  activeTab === 'windows'
                    ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                    : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                <Terminal size={14} />
                <span>Windows</span>
              </button>
              <button
                onClick={() => setActiveTab('macos')}
                className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium border-b-2 transition-all ${
                  activeTab === 'macos'
                    ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                    : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                <Terminal size={14} />
                <span>macOS</span>
              </button>
              <button
                onClick={() => setActiveTab('android')}
                className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium border-b-2 transition-all ${
                  activeTab === 'android'
                    ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                    : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                <Smartphone size={14} />
                <span>Android</span>
              </button>
              <button
                onClick={() => setActiveTab('ios')}
                className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium border-b-2 transition-all ${
                  activeTab === 'ios'
                    ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                    : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                <Smartphone size={14} />
                <span>iOS</span>
              </button>
            </div>

            {/* Tab content */}
            <div className="p-4 rounded-xl bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] text-xs text-[var(--color-text-secondary)] space-y-2.5">
              {activeTab === 'windows' && (
                <ol className="list-decimal list-inside space-y-1.5 leading-relaxed">
                  <li>下载 PEM 或 DER 格式根证书文件到本地。</li>
                  <li>双击证书文件，点击「安装证书」。</li>
                  <li>
                    存储位置选择「当前用户」或「本地计算机」，点击下一步。
                  </li>
                  <li>选择「将所有的证书都放入下列存储」，点击「浏览」。</li>
                  <li>
                    选择{' '}
                    <strong className="text-[var(--color-text-primary)]">
                      「受信任的根证书颁发机构」
                    </strong>{' '}
                    并确定。
                  </li>
                  <li>完成向导并点击「是」确认信任。</li>
                </ol>
              )}

              {activeTab === 'macos' && (
                <ol className="list-decimal list-inside space-y-1.5 leading-relaxed">
                  <li>
                    下载证书文件，双击打开「钥匙串访问 (Keychain Access)」。
                  </li>
                  <li>将证书拖入「系统」或「登录」钥匙串中。</li>
                  <li>
                    双击找到名为{' '}
                    <strong className="text-[var(--color-text-primary)]">
                      BrowserCLI MITM CA
                    </strong>{' '}
                    的证书。
                  </li>
                  <li>
                    展开「信任」区域，将「使用此证书时」设置为{' '}
                    <strong className="text-[var(--color-text-primary)]">
                      「始终信任」
                    </strong>
                    。
                  </li>
                  <li>关闭窗口并输入管理员密码保存更改。</li>
                </ol>
              )}

              {activeTab === 'android' && (
                <ol className="list-decimal list-inside space-y-1.5 leading-relaxed">
                  <li>在手机浏览器中下载 DER 证书（或传至手机存储）。</li>
                  <li>
                    进入系统「设置」→「安全」→「加密与凭据」或「更多安全设置」。
                  </li>
                  <li>点击「从存储设备安装证书」→ 选择「CA 证书」。</li>
                  <li>
                    系统提示警告时点击「仍然安装」，选择下载的证书文件完成安装。
                  </li>
                  <li>
                    <span className="text-amber-400">注意：</span>Android 7.0+
                    默认不信任用户凭据，部分 App 需配合 Root 或 Xposed/Magisk
                    模块信任系统 CA。
                  </li>
                </ol>
              )}

              {activeTab === 'ios' && (
                <ol className="list-decimal list-inside space-y-1.5 leading-relaxed">
                  <li>使用 Safari 浏览器打开下载链接并允许下载描述文件。</li>
                  <li>
                    进入系统「设置」→ 顶部「已下载描述文件」→ 点击「安装」。
                  </li>
                  <li>输入锁屏密码确认安装完成。</li>
                  <li>
                    关键步骤：进入「设置」→「通用」→「关于本机」→「证书信任设置」。
                  </li>
                  <li>
                    在「针对根证书启用完全信任」中，开启{' '}
                    <strong className="text-[var(--color-text-primary)]">
                      BrowserCLI MITM CA
                    </strong>{' '}
                    的开关。
                  </li>
                </ol>
              )}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--color-border-default)] bg-[var(--color-bg-tertiary)]/50">
          <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            <Info size={14} />
            <span>证书仅在本地机器自动生成，请妥善保管私钥</span>
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] transition-colors"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
};
