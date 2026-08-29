/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  Check,
  Code2,
  Copy,
  Download,
  FileText,
  Key,
  Layers,
  Loader2,
  Lock,
  Terminal,
} from 'lucide-react';
import React, {useState} from 'react';

import type {SessionRequestDetail} from '../../lib/protocol';
import {useProxyStore} from '../../stores/proxy';

type DetailTab =
  | 'general'
  | 'headers'
  | 'request-body'
  | 'response-body'
  | 'actions';

const SENSITIVE_HEADER_PATTERN =
  /^(authorization|cookie|set-cookie|token|x-.*-token|sign|signature|x-sign|x-signature|x-s|a_bogus|xbogus|h5st|k-sign)/i;

// session 存储层没有 is_static 列（adapter 刻意丢弃，spec §10），这里按 url
// 后缀 + contentType 推导，仅供前端展示 Static 徽标。
const STATIC_EXTENSIONS =
  /\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|ico|map)(\?|$)/i;

function isStaticRequest(req: SessionRequestDetail): boolean {
  if (STATIC_EXTENSIONS.test(req.url)) return true;
  const ct = req.contentType ?? '';
  return (
    ct.startsWith('image/') ||
    ct.startsWith('font/') ||
    ct.includes('javascript') ||
    ct.includes('text/css')
  );
}

export const ProxyRequestDetail: React.FC = () => {
  const {selectedDetail, detailLoading} = useProxyStore();
  const [activeTab, setActiveTab] = useState<DetailTab>('general');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyText = (text: string, key: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleDownloadResponse = () => {
    if (!selectedDetail || !selectedDetail.responseBody) return;
    const blob = new Blob([selectedDetail.responseBody], {
      type: selectedDetail.contentType || 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const ext = selectedDetail.contentType?.includes('json') ? 'json' : 'txt';
    link.download = `response-${selectedDetail.id}.${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (detailLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[var(--color-bg-primary)]">
        <Loader2
          size={24}
          className="animate-spin text-[var(--color-accent)] mb-2"
        />
        <span className="text-xs text-[var(--color-text-secondary)]">
          加载请求详情中...
        </span>
      </div>
    );
  }

  if (!selectedDetail) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[var(--color-bg-primary)]">
        <div className="w-12 h-12 rounded-2xl bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] flex items-center justify-center text-[var(--color-text-muted)] mb-3">
          <Layers size={22} />
        </div>
        <p className="text-xs font-semibold text-[var(--color-text-primary)]">
          未选中请求
        </p>
        <p className="text-[11px] text-[var(--color-text-muted)] max-w-xs leading-relaxed mt-1">
          在左侧列表中点击任意捕获记录，即可在此查看请求标头、Body、响应体及一键生成代码。
        </p>
      </div>
    );
  }

  // Format JSON if possible
  const formatBody = (bodyStr: string | null) => {
    if (!bodyStr) return '(Empty Body)';
    try {
      const parsed = JSON.parse(bodyStr);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return bodyStr;
    }
  };

  // Generate curl command
  const generateCurl = (req: SessionRequestDetail): string => {
    let cmd = `curl -X ${req.method} '${req.url}'`;
    for (const [k, v] of Object.entries(req.requestHeaders || {})) {
      if (k.toLowerCase() === 'host') continue;
      cmd += ` \\\n  -H '${k}: ${v.replace(/'/g, "'\\''")}'`;
    }
    if (req.requestBody) {
      cmd += ` \\\n  --data-raw '${req.requestBody.replace(/'/g, "'\\''")}'`;
    }
    return cmd;
  };

  // Generate Python requests code
  const generatePython = (req: SessionRequestDetail): string => {
    let code = `import requests\n\nurl = '${req.url}'\n`;
    code += `headers = ${JSON.stringify(req.requestHeaders || {}, null, 4)}\n\n`;

    if (req.requestBody) {
      try {
        const jsonBody = JSON.parse(req.requestBody);
        code += `data = ${JSON.stringify(jsonBody, null, 4)}\n\n`;
        code += `response = requests.${req.method.toLowerCase()}(url, headers=headers, json=data)\n`;
      } catch {
        code += `data = ${JSON.stringify(req.requestBody)}\n\n`;
        code += `response = requests.${req.method.toLowerCase()}(url, headers=headers, data=data)\n`;
      }
    } else {
      code += `response = requests.${req.method.toLowerCase()}(url, headers=headers)\n`;
    }

    code += `print(response.status_code)\nprint(response.text)\n`;
    return code;
  };

  const reqHeaders = Object.entries(selectedDetail.requestHeaders || {});
  const resHeaders = Object.entries(selectedDetail.responseHeaders || {});

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--color-bg-primary)]">
      {/* Top Tabs */}
      <div className="flex items-center justify-between border-b border-[var(--color-border-default)] bg-[var(--color-bg-secondary)]/50 px-4 pt-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab('general')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-all ${
              activeTab === 'general'
                ? 'border-[var(--color-accent)] text-[var(--color-accent)] font-bold'
                : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            <FileText size={13} />
            <span>概览</span>
          </button>

          <button
            onClick={() => setActiveTab('headers')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-all ${
              activeTab === 'headers'
                ? 'border-[var(--color-accent)] text-[var(--color-accent)] font-bold'
                : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            <Key size={13} />
            <span>标头 ({reqHeaders.length + resHeaders.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('request-body')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-all ${
              activeTab === 'request-body'
                ? 'border-[var(--color-accent)] text-[var(--color-accent)] font-bold'
                : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            <Code2 size={13} />
            <span>请求体 {selectedDetail.requestBody ? '•' : ''}</span>
          </button>

          <button
            onClick={() => setActiveTab('response-body')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-all ${
              activeTab === 'response-body'
                ? 'border-[var(--color-accent)] text-[var(--color-accent)] font-bold'
                : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            <Code2 size={13} />
            <span>响应体 {selectedDetail.responseBody ? '•' : ''}</span>
          </button>

          <button
            onClick={() => setActiveTab('actions')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-all ${
              activeTab === 'actions'
                ? 'border-[var(--color-accent)] text-[var(--color-accent)] font-bold'
                : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            <Terminal size={13} />
            <span>代码生成</span>
          </button>
        </div>

        {/* Top actions quick copy */}
        <div className="flex items-center gap-2 pb-2">
          <button
            onClick={() => copyText(generateCurl(selectedDetail), 'quick-curl')}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] text-[11px] font-mono text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-accent)] transition-all"
            title="复制为 cURL 命令行"
          >
            {copiedKey === 'quick-curl' ? (
              <Check
                size={12}
                className="text-emerald-400"
              />
            ) : (
              <Copy size={12} />
            )}
            <span>cURL</span>
          </button>
        </div>
      </div>

      {/* Tab Panels */}
      <div className="flex-1 overflow-y-auto p-4 select-text">
        {/* 1. General Info Tab */}
        {activeTab === 'general' && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] space-y-3">
              <h3 className="text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">
                请求信息
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
                <div>
                  <span className="text-[var(--color-text-muted)] block text-[10px]">
                    Request URL
                  </span>
                  <span className="text-[var(--color-text-primary)] break-all font-semibold select-all">
                    {selectedDetail.url}
                  </span>
                </div>

                <div>
                  <span className="text-[var(--color-text-muted)] block text-[10px]">
                    Method
                  </span>
                  <span className="text-[var(--color-text-primary)] font-bold uppercase">
                    {selectedDetail.method}
                  </span>
                </div>

                <div>
                  <span className="text-[var(--color-text-muted)] block text-[10px]">
                    Status Code
                  </span>
                  <span className="text-[var(--color-text-primary)] font-bold">
                    {selectedDetail.statusCode || 'Pending / Unknown'}
                  </span>
                </div>

                <div>
                  <span className="text-[var(--color-text-muted)] block text-[10px]">
                    Timestamp
                  </span>
                  <span className="text-[var(--color-text-primary)]">
                    {new Date(selectedDetail.timestamp).toLocaleString()}
                  </span>
                </div>

                <div>
                  <span className="text-[var(--color-text-muted)] block text-[10px]">
                    Content-Type
                  </span>
                  <span className="text-[var(--color-text-primary)]">
                    {selectedDetail.contentType || 'None'}
                  </span>
                </div>

                <div>
                  <span className="text-[var(--color-text-muted)] block text-[10px]">
                    Capture Properties
                  </span>
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {selectedDetail.isWebSocket === 1 && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] bg-purple-500/15 text-purple-400 border border-purple-500/30">
                        WebSocket
                      </span>
                    )}
                    {selectedDetail.isStreaming === 1 && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] bg-blue-500/15 text-blue-400 border border-blue-500/30">
                        SSE
                      </span>
                    )}
                    {isStaticRequest(selectedDetail) && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] bg-zinc-500/15 text-zinc-400 border border-zinc-500/30">
                        Static
                      </span>
                    )}
                    {selectedDetail.truncated === 1 && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] bg-amber-500/15 text-amber-400 border border-amber-500/30">
                        Truncated (&gt;1MB)
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 2. Headers Tab */}
        {activeTab === 'headers' && (
          <div className="space-y-6 font-mono text-xs">
            {/* Request Headers */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider flex items-center gap-1.5">
                  <span>Request Headers</span>
                  <span className="text-[10px] text-[var(--color-text-muted)]">
                    ({reqHeaders.length})
                  </span>
                </h3>
                <button
                  onClick={() =>
                    copyText(
                      JSON.stringify(
                        selectedDetail.requestHeaders || {},
                        null,
                        2,
                      ),
                      'req-headers',
                    )
                  }
                  className="flex items-center gap-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                >
                  {copiedKey === 'req-headers' ? (
                    <Check
                      size={12}
                      className="text-emerald-400"
                    />
                  ) : (
                    <Copy size={12} />
                  )}
                  <span>复制 JSON</span>
                </button>
              </div>

              <div className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)]/60 divide-y divide-[var(--color-border-muted)] overflow-hidden">
                {reqHeaders.length === 0 ? (
                  <div className="p-3 text-[var(--color-text-muted)] italic text-center">
                    无请求标头
                  </div>
                ) : (
                  reqHeaders.map(([k, v]) => {
                    const isSensitive = SENSITIVE_HEADER_PATTERN.test(k);
                    return (
                      <div
                        key={k}
                        className={`flex flex-col sm:flex-row sm:items-baseline gap-2 p-2.5 hover:bg-[var(--color-bg-tertiary)]/50 transition-colors ${
                          isSensitive ? 'bg-purple-500/5' : ''
                        }`}
                      >
                        <span
                          className={`font-semibold shrink-0 sm:w-44 truncate flex items-center gap-1 ${
                            isSensitive
                              ? 'text-purple-400 font-bold'
                              : 'text-[var(--color-text-primary)]'
                          }`}
                          title={k}
                        >
                          {isSensitive && (
                            <Lock
                              size={10}
                              className="text-purple-400 shrink-0"
                            />
                          )}
                          {k}:
                        </span>
                        <span
                          className={`break-all flex-1 text-[11px] ${
                            isSensitive
                              ? 'text-purple-300 font-medium'
                              : 'text-[var(--color-text-secondary)]'
                          }`}
                        >
                          {v}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Response Headers */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider flex items-center gap-1.5">
                  <span>Response Headers</span>
                  <span className="text-[10px] text-[var(--color-text-muted)]">
                    ({resHeaders.length})
                  </span>
                </h3>
                <button
                  onClick={() =>
                    copyText(
                      JSON.stringify(
                        selectedDetail.responseHeaders || {},
                        null,
                        2,
                      ),
                      'res-headers',
                    )
                  }
                  className="flex items-center gap-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                >
                  {copiedKey === 'res-headers' ? (
                    <Check
                      size={12}
                      className="text-emerald-400"
                    />
                  ) : (
                    <Copy size={12} />
                  )}
                  <span>复制 JSON</span>
                </button>
              </div>

              <div className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)]/60 divide-y divide-[var(--color-border-muted)] overflow-hidden">
                {resHeaders.length === 0 ? (
                  <div className="p-3 text-[var(--color-text-muted)] italic text-center">
                    无响应标头
                  </div>
                ) : (
                  resHeaders.map(([k, v]) => {
                    const isSensitive = SENSITIVE_HEADER_PATTERN.test(k);
                    return (
                      <div
                        key={k}
                        className={`flex flex-col sm:flex-row sm:items-baseline gap-2 p-2.5 hover:bg-[var(--color-bg-tertiary)]/50 transition-colors ${
                          isSensitive ? 'bg-amber-500/5' : ''
                        }`}
                      >
                        <span
                          className={`font-semibold shrink-0 sm:w-44 truncate flex items-center gap-1 ${
                            isSensitive
                              ? 'text-amber-400 font-bold'
                              : 'text-[var(--color-text-primary)]'
                          }`}
                          title={k}
                        >
                          {isSensitive && (
                            <Lock
                              size={10}
                              className="text-amber-400 shrink-0"
                            />
                          )}
                          {k}:
                        </span>
                        <span
                          className={`break-all flex-1 text-[11px] ${
                            isSensitive
                              ? 'text-amber-300 font-medium'
                              : 'text-[var(--color-text-secondary)]'
                          }`}
                        >
                          {v}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {/* 3. Request Body Tab */}
        {activeTab === 'request-body' && (
          <div className="space-y-2 h-full flex flex-col">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">
                Request Body Content
              </span>
              {selectedDetail.requestBody && (
                <button
                  onClick={() =>
                    copyText(selectedDetail.requestBody || '', 'req-body')
                  }
                  className="flex items-center gap-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] font-mono"
                >
                  {copiedKey === 'req-body' ? (
                    <Check
                      size={12}
                      className="text-emerald-400"
                    />
                  ) : (
                    <Copy size={12} />
                  )}
                  <span>复制 Body</span>
                </button>
              )}
            </div>

            <pre className="flex-1 p-4 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] font-mono text-xs text-[var(--color-text-primary)] overflow-auto leading-relaxed max-h-[65vh]">
              {formatBody(selectedDetail.requestBody)}
            </pre>
          </div>
        )}

        {/* 4. Response Body Tab */}
        {activeTab === 'response-body' && (
          <div className="space-y-2 h-full flex flex-col">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">
                Response Body Content
              </span>
              <div className="flex items-center gap-3">
                {selectedDetail.responseBody && (
                  <>
                    <button
                      onClick={handleDownloadResponse}
                      className="flex items-center gap-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] font-mono"
                      title="下载响应体文件"
                    >
                      <Download size={12} />
                      <span>下载</span>
                    </button>
                    <button
                      onClick={() =>
                        copyText(selectedDetail.responseBody || '', 'res-body')
                      }
                      className="flex items-center gap-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] font-mono"
                    >
                      {copiedKey === 'res-body' ? (
                        <Check
                          size={12}
                          className="text-emerald-400"
                        />
                      ) : (
                        <Copy size={12} />
                      )}
                      <span>复制 Body</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            <pre className="flex-1 p-4 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] font-mono text-xs text-[var(--color-text-primary)] overflow-auto leading-relaxed max-h-[65vh]">
              {formatBody(selectedDetail.responseBody)}
            </pre>
          </div>
        )}

        {/* 5. Actions / Code Generator Tab */}
        {activeTab === 'actions' && (
          <div className="space-y-6 font-mono">
            {/* cURL Section */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider flex items-center gap-1.5">
                  <Terminal
                    size={14}
                    className="text-[var(--color-accent)]"
                  />
                  <span>cURL Command</span>
                </span>
                <button
                  onClick={() =>
                    copyText(generateCurl(selectedDetail), 'curl-full')
                  }
                  className="flex items-center gap-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                >
                  {copiedKey === 'curl-full' ? (
                    <Check
                      size={12}
                      className="text-emerald-400"
                    />
                  ) : (
                    <Copy size={12} />
                  )}
                  <span>复制 cURL</span>
                </button>
              </div>

              <pre className="p-4 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] text-xs text-[var(--color-text-primary)] overflow-x-auto leading-relaxed">
                {generateCurl(selectedDetail)}
              </pre>
            </div>

            {/* Python Requests Section */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider flex items-center gap-1.5">
                  <Code2
                    size={14}
                    className="text-emerald-400"
                  />
                  <span>Python (requests)</span>
                </span>
                <button
                  onClick={() =>
                    copyText(generatePython(selectedDetail), 'py-full')
                  }
                  className="flex items-center gap-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                >
                  {copiedKey === 'py-full' ? (
                    <Check
                      size={12}
                      className="text-emerald-400"
                    />
                  ) : (
                    <Copy size={12} />
                  )}
                  <span>复制 Python</span>
                </button>
              </div>

              <pre className="p-4 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] text-xs text-emerald-300 overflow-x-auto leading-relaxed">
                {generatePython(selectedDetail)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
