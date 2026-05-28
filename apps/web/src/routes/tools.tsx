import { useEffect, useState } from 'react';
import { 
  Wrench, 
  Search, 
  Play, 
  AlertCircle, 
  Loader2, 
  Clock, 
  Terminal, 
  ChevronRight, 
  Layers,
  HelpCircle
} from 'lucide-react';
import { api, type ToolSummary, type CallToolResult } from '../lib/api';

export default function ToolsPage() {
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // 搜索和过滤
  const [searchQuery, setSearchQuery] = useState('');
  
  // 当前选中的工具
  const [selectedTool, setSelectedTool] = useState<ToolSummary | null>(null);
  
  // 表单状态
  const [formValues, setFormValues] = useState<Record<string, any>>({});
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  
  // 执行状态
  const [executing, setExecuting] = useState(false);
  const [execResult, setExecResult] = useState<CallToolResult | null>(null);
  const [execError, setExecError] = useState<any>(null);
  const [lastInvocation, setLastInvocation] = useState<{
    traceId?: string;
    status: 'success' | 'failed';
    durationMs?: number;
    timestamp: number;
    toolName: string;
  } | null>(null);

  // 获取全部工具列表
  const fetchTools = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getTools();
      setTools(data.tools || []);
      setTotal(data.total || 0);
      if (data.tools && data.tools.length > 0) {
        setSelectedTool(data.tools[0]);
      }
    } catch (err) {
      console.error('Failed to fetch tools:', err);
      setError(err instanceof Error ? err.message : '获取工具列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTools();
  }, []);

  // 当选中的工具改变时，初始化表单值
  useEffect(() => {
    if (!selectedTool) return;
    
    const schema = selectedTool.inputSchema || selectedTool.jsonSchema || {};
    const properties = schema.properties || {};
    const initialValues: Record<string, any> = {};
    
    // 遍历 schema 属性设置默认值
    Object.keys(properties).forEach(key => {
      const prop = properties[key];
      if (prop.default !== undefined) {
        initialValues[key] = prop.default;
      } else if (prop.type === 'boolean') {
        initialValues[key] = false;
      } else {
        initialValues[key] = '';
      }
    });
    
    setFormValues(initialValues);
    setFormErrors({});
    setExecResult(null);
    setExecError(null);
  }, [selectedTool]);

  // 处理表单输入域改变
  const handleFieldChange = (key: string, value: any, type: string) => {
    // 校验和清空当前字段的错误
    if (formErrors[key]) {
      const newErrors = { ...formErrors };
      delete newErrors[key];
      setFormErrors(newErrors);
    }

    // 类型还原与更新
    let parsedValue = value;
    if (value !== '') {
      if (type === 'number' || type === 'integer') {
        parsedValue = Number(value);
      } else if (type === 'boolean') {
        parsedValue = Boolean(value);
      }
    }

    setFormValues(prev => ({
      ...prev,
      [key]: parsedValue
    }));
  };

  // 执行工具
  const handleExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTool) return;

    const schema = selectedTool.inputSchema || selectedTool.jsonSchema || {};
    const properties = schema.properties || {};
    const required: string[] = schema.required || [];
    const errors: Record<string, string> = {};

    // 必填项拦截
    required.forEach(key => {
      const val = formValues[key];
      const prop = properties[key];
      
      if (prop?.type === 'boolean') {
        // 布尔类型 false 也是有效输入，不能判断为空
        if (val === undefined || val === null) {
          errors[key] = '该字段是必填项';
        }
      } else {
        if (val === undefined || val === null || (typeof val === 'string' && val.trim() === '')) {
          errors[key] = '该字段是必填项';
        }
      }
    });

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      // 滚动到第一个错误
      const firstErrorKey = Object.keys(errors)[0];
      const element = document.getElementById(`field-${firstErrorKey}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    // 清洗参数，过滤掉未填写的非必选字段
    const cleanedArgs: Record<string, any> = {};
    Object.keys(formValues).forEach(key => {
      const val = formValues[key];
      
      // 如果字段是必填，或者非必填但用户输入了有效内容，就加入 payload
      if (required.includes(key)) {
        cleanedArgs[key] = val;
      } else if (val !== undefined && val !== null && val !== '') {
        cleanedArgs[key] = val;
      }
    });

    setExecuting(true);
    setExecResult(null);
    setExecError(null);

    const startTime = Date.now();
    try {
      const res = await api.callTool(selectedTool.name, cleanedArgs);
      setExecResult(res);
      setLastInvocation({
        traceId: res.traceId,
        status: 'success',
        durationMs: res.durationMs || (Date.now() - startTime),
        timestamp: Date.now(),
        toolName: selectedTool.name
      });
    } catch (err: any) {
      console.error('Tool execution failed:', err);
      setExecError(err);
      setLastInvocation({
        traceId: err.traceId || undefined,
        status: 'failed',
        durationMs: Date.now() - startTime,
        timestamp: Date.now(),
        toolName: selectedTool.name
      });
    } finally {
      setExecuting(false);
    }
  };

  // 根据搜索过滤工具
  const filteredTools = tools.filter(t => {
    const q = searchQuery.toLowerCase();
    return (
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      (t.category && t.category.toLowerCase().includes(q))
    );
  });

  // 按照 category 分组工具
  const groupedTools = filteredTools.reduce((groups, tool) => {
    const category = tool.category || '未分类';
    if (!groups[category]) {
      groups[category] = [];
    }
    groups[category].push(tool);
    return groups;
  }, {} as Record<string, ToolSummary[]>);

  // 解析并生成 Schema 的控件配置
  const renderField = (key: string, prop: any, isRequired: boolean) => {
    const type = prop.type;
    const desc = prop.description || '';
    const hasError = !!formErrors[key];

    // 判断是否自动升级为 Textarea
    const isTextArea = 
      type === 'string' && 
      !prop.enum && 
      (/code|script|text|body|payload|cookie|data|headers|json/i.test(key) || 
       /code|script|text|body|payload|cookie|data|headers|json/i.test(desc));

    const inputBaseClass = `w-full bg-[var(--color-bg-primary)] border rounded-lg px-3.5 py-2 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-1 transition-all duration-200 ${
      hasError 
        ? 'border-red-500/50 focus:border-red-500 focus:ring-red-500/30' 
        : 'border-[var(--color-border-default)] focus:border-[var(--color-accent)] focus:ring-[var(--color-accent)]/30 hover:border-[var(--color-border-default)]/80'
    }`;

    return (
      <div key={key} id={`field-${key}`} className="space-y-1.5">
        <div className="flex justify-between items-center">
          <label htmlFor={key} className="text-xs font-semibold text-[var(--color-text-secondary)] tracking-wide flex items-center gap-1">
            {key}
            {isRequired && <span className="text-[var(--color-status-red)]">*</span>}
          </label>
          {type && (
            <span className="text-[10px] font-mono text-[var(--color-text-muted)] bg-[var(--color-bg-primary)] px-1.5 py-0.5 rounded border border-[var(--color-border-muted)]">
              {type}{prop.enum ? ' (enum)' : ''}
            </span>
          )}
        </div>

        {/* 控件分配 */}
        {type === 'boolean' ? (
          <div className="flex items-center gap-3 py-1.5">
            <label className="relative inline-flex items-center cursor-pointer select-none">
              <input
                id={key}
                type="checkbox"
                checked={!!formValues[key]}
                onChange={(e) => handleFieldChange(key, e.target.checked, 'boolean')}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-[var(--color-bg-primary)] peer-focus:outline-none rounded-full peer border border-[var(--color-border-default)] peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-[var(--color-text-muted)] peer-checked:after:bg-[var(--color-bg-primary)] after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[var(--color-accent)] peer-checked:border-[var(--color-accent)]" />
              <span className="ml-3 text-xs text-[var(--color-text-secondary)]">
                {formValues[key] ? '启用 (True)' : '禁用 (False)'}
              </span>
            </label>
          </div>
        ) : prop.enum ? (
          <select
            id={key}
            value={formValues[key] || ''}
            onChange={(e) => handleFieldChange(key, e.target.value, 'string')}
            className={inputBaseClass}
          >
            <option value="" className="text-[var(--color-text-muted)]">请选择参数值...</option>
            {prop.enum.map((opt: string) => (
              <option key={opt} value={opt} className="bg-[var(--color-bg-secondary)]">
                {opt}
              </option>
            ))}
          </select>
        ) : isTextArea ? (
          <textarea
            id={key}
            rows={5}
            placeholder={`请输入 ${key}...`}
            value={formValues[key] || ''}
            onChange={(e) => handleFieldChange(key, e.target.value, 'string')}
            className={`${inputBaseClass} font-mono text-xs resize-y`}
          />
        ) : type === 'number' || type === 'integer' ? (
          <input
            id={key}
            type="number"
            placeholder={`请输入数值...`}
            value={formValues[key] ?? ''}
            onChange={(e) => handleFieldChange(key, e.target.value === '' ? '' : Number(e.target.value), type)}
            className={inputBaseClass}
          />
        ) : (
          <input
            id={key}
            type="text"
            placeholder={`请输入内容...`}
            value={formValues[key] || ''}
            onChange={(e) => handleFieldChange(key, e.target.value, 'string')}
            className={inputBaseClass}
          />
        )}

        {/* 字段描述 */}
        {desc && (
          <p className="text-[11px] text-[var(--color-text-muted)] leading-relaxed italic">
            {desc}
          </p>
        )}

        {/* 错误提示 */}
        {hasError && (
          <p className="text-[11px] text-[var(--color-status-red)] flex items-center gap-1 font-medium animate-pulse">
            <AlertCircle size={10} />
            {formErrors[key]}
          </p>
        )}
      </div>
    );
  };

  // 生成右侧主面板 schema 结构
  const schema = selectedTool?.inputSchema || selectedTool?.jsonSchema || {};
  const properties = schema.properties || {};
  const requiredFields = schema.required || [];
  const propertyKeys = Object.keys(properties);

  return (
    <div className="flex-1 flex flex-col md:flex-row h-full overflow-hidden select-none bg-[var(--color-bg-primary)]">
      {/* 左侧栏 - 工具列表 */}
      <div className="w-full md:w-80 border-r border-[var(--color-border-default)] bg-[var(--color-bg-secondary)]/30 backdrop-blur-md flex flex-col h-1/2 md:h-full overflow-hidden">
        {/* 搜索过滤栏 */}
        <div className="p-4 border-b border-[var(--color-border-muted)] space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-wider text-[var(--color-text-primary)] flex items-center gap-2">
              <Wrench size={14} className="text-[var(--color-accent)]" />
              RPC 远程工具
            </h2>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] text-[var(--color-text-secondary)]">
              共 {total} 个
            </span>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-[var(--color-text-muted)]" size={14} />
            <input
              type="text"
              placeholder="搜索名称、描述或分类..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] focus:border-[var(--color-accent)] rounded-lg pl-9 pr-3 py-1.5 text-xs text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]/30 transition-all duration-200"
            />
          </div>
        </div>

        {/* 滚动工具列表 */}
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-[var(--color-text-muted)] gap-2">
              <Loader2 className="animate-spin text-[var(--color-accent)]" size={20} />
              <span className="text-xs">加载工具列表中...</span>
            </div>
          ) : error ? (
            <div className="p-4 text-center border border-red-500/20 bg-red-500/5 rounded-xl space-y-2">
              <p className="text-xs text-[var(--color-status-red)]">{error}</p>
              <button 
                onClick={fetchTools}
                className="text-[10px] px-3 py-1 bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] rounded-md transition-all active:scale-95"
              >
                重试加载
              </button>
            </div>
          ) : filteredTools.length === 0 ? (
            <div className="text-center py-12 text-[var(--color-text-muted)] text-xs">
              无匹配的工具
            </div>
          ) : (
            Object.keys(groupedTools).map(category => (
              <div key={category} className="space-y-1.5">
                <div className="flex items-center gap-1.5 px-2 text-[10px] font-bold text-[var(--color-text-muted)] tracking-widest uppercase">
                  <Layers size={10} className="text-[var(--color-accent)]/60" />
                  {category}
                </div>
                <div className="space-y-1">
                  {groupedTools[category].map(tool => {
                    const isSelected = selectedTool?.name === tool.name;
                    return (
                      <button
                        key={tool.name}
                        onClick={() => setSelectedTool(tool)}
                        className={`w-full text-left p-3 rounded-xl border transition-all duration-200 group flex items-start justify-between gap-2 relative overflow-hidden ${
                          isSelected
                            ? 'bg-[var(--color-bg-tertiary)] border-[var(--color-accent)]/40 text-[var(--color-accent)] shadow-md shadow-black/10'
                            : 'bg-transparent border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)]/30 hover:border-[var(--color-border-muted)]'
                        }`}
                      >
                        {isSelected && (
                          <div className="absolute left-0 top-0 bottom-0 w-1 bg-[var(--color-accent)]" />
                        )}
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="font-semibold text-xs truncate group-hover:translate-x-0.5 transition-transform duration-200">
                            {tool.name}
                          </div>
                          <div className="text-[11px] text-[var(--color-text-muted)] line-clamp-2 leading-relaxed">
                            {tool.description}
                          </div>
                        </div>
                        <ChevronRight 
                          size={12} 
                          className={`mt-0.5 shrink-0 transition-all duration-200 ${
                            isSelected ? 'text-[var(--color-accent)] translate-x-0.5' : 'text-[var(--color-text-muted)] group-hover:text-[var(--color-text-primary)]'
                          }`} 
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 右侧主面板 - 工具配置与执行 */}
      <div className="flex-1 flex flex-col h-1/2 md:h-full overflow-hidden bg-[var(--color-bg-primary)]">
        {selectedTool ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* 工具基础信息头部 */}
            <div className="p-6 border-b border-[var(--color-border-muted)] space-y-3 shrink-0 bg-[var(--color-bg-secondary)]/15">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h1 className="text-base font-bold text-[var(--color-text-primary)] tracking-tight">
                      {selectedTool.name}
                    </h1>
                    {selectedTool.profile && (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        {selectedTool.profile}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
                    {selectedTool.description}
                  </p>
                </div>
              </div>
            </div>

            {/* 滚动容器：包含配置表单与执行结果 */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
                
                {/* 1. 参数配置区 */}
                <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-xl shadow-lg p-5 space-y-4">
                  <div className="flex items-center justify-between border-b border-[var(--color-border-muted)] pb-3">
                    <h3 className="text-xs font-bold tracking-wider text-[var(--color-text-primary)] uppercase flex items-center gap-2">
                      <Terminal size={12} className="text-[var(--color-accent)]" />
                      参数输入规范
                    </h3>
                    <span className="text-[10px] text-[var(--color-text-muted)]">
                      {propertyKeys.length} 个参数已注册
                    </span>
                  </div>

                  {propertyKeys.length === 0 ? (
                    <div className="py-6 text-center text-xs text-[var(--color-text-muted)] italic">
                      无参数需要输入，该工具可以直接触发。
                    </div>
                  ) : (
                    <form onSubmit={handleExecute} className="space-y-4">
                      <div className="space-y-4">
                        {propertyKeys.map(key => {
                          const prop = properties[key];
                          const isRequired = requiredFields.includes(key);
                          return renderField(key, prop, isRequired);
                        })}
                      </div>
                    </form>
                  )}

                  <div className="pt-2 border-t border-[var(--color-border-muted)]">
                    <button
                      type="submit"
                      onClick={handleExecute}
                      disabled={executing}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-lg bg-[var(--color-accent)] text-[var(--color-bg-primary)] hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none shadow-lg shadow-[var(--color-accent)]/15"
                    >
                      {executing ? (
                        <>
                          <Loader2 size={13} className="animate-spin" />
                          <span>正在调用 RPC 方法...</span>
                        </>
                      ) : (
                        <>
                          <Play size={12} fill="currentColor" />
                          <span>执行工具 (Execute)</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* 2. 执行结果与历史追踪 */}
                <div className="space-y-6">
                  {/* 执行结果面板 */}
                  <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-xl shadow-lg p-5 flex flex-col min-h-[260px] relative overflow-hidden">
                    <div className="flex items-center justify-between border-b border-[var(--color-border-muted)] pb-3 mb-4">
                      <h3 className="text-xs font-bold tracking-wider text-[var(--color-text-primary)] uppercase flex items-center gap-2">
                        <HelpCircle size={12} className="text-[var(--color-accent)]" />
                        执行结果面板
                      </h3>
                      {lastInvocation && lastInvocation.toolName === selectedTool.name && (
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full flex items-center gap-1 border ${
                          lastInvocation.status === 'success'
                            ? 'bg-emerald-500/10 text-[var(--color-status-green)] border-emerald-500/20'
                            : 'bg-red-500/10 text-[var(--color-status-red)] border-red-500/20'
                        }`}>
                          <span className={`w-1 h-1 rounded-full ${lastInvocation.status === 'success' ? 'bg-[var(--color-status-green)]' : 'bg-[var(--color-status-red)]'}`} />
                          {lastInvocation.status === 'success' ? 'SUCCESS' : 'FAILED'}
                        </span>
                      )}
                    </div>

                    {executing ? (
                      <div className="flex-1 flex flex-col items-center justify-center py-12 gap-3">
                        <div className="relative">
                          <Loader2 className="animate-spin text-[var(--color-accent)] relative z-10" size={32} />
                          <div className="absolute inset-0 bg-[var(--color-accent)]/15 filter blur-lg rounded-full" />
                        </div>
                        <div className="text-center space-y-1">
                          <p className="text-xs font-medium text-[var(--color-text-primary)]">通信中...</p>
                          <p className="text-[10px] text-[var(--color-text-muted)] font-mono">发送 RPC 调用 payload 并等待回调</p>
                        </div>
                      </div>
                    ) : execResult ? (
                      <div className="flex-1 flex flex-col space-y-3">
                        <div className="flex items-center justify-between text-[10px] text-[var(--color-text-muted)] bg-[var(--color-bg-primary)] px-3 py-1.5 rounded-lg border border-[var(--color-border-muted)] font-mono">
                          <span className="truncate max-w-[150px]" title={execResult.traceId}>Trace: {execResult.traceId}</span>
                          <span>耗时: {execResult.durationMs.toFixed(1)}ms</span>
                        </div>
                        <div className="relative flex-1 group">
                          <pre className="font-mono bg-[var(--color-bg-primary)] p-4 rounded-lg border border-[var(--color-border-default)] text-emerald-400 overflow-auto max-h-96 text-xs leading-relaxed select-text">
                            {JSON.stringify(execResult.result, null, 2)}
                          </pre>
                        </div>
                      </div>
                    ) : execError ? (
                      <div className="flex-1 flex flex-col space-y-3">
                        <div className="bg-red-500/5 border border-red-500/20 p-4 rounded-lg text-[var(--color-status-red)] text-xs space-y-2">
                          <div className="flex items-center gap-2">
                            <AlertCircle size={14} />
                            <span className="font-semibold text-sm">RPC 调用失败</span>
                          </div>
                          <p className="font-mono bg-[var(--color-bg-primary)] p-3 rounded border border-red-500/10 text-red-400 select-text overflow-auto max-h-40">
                            {execError.message || String(execError)}
                          </p>
                          {execError.code && (
                            <div className="text-[10px] text-red-400/80 font-mono">
                              Error Code: {execError.code}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center text-center py-12 border border-dashed border-[var(--color-border-default)] rounded-xl bg-[var(--color-bg-primary)]/20">
                        <Terminal size={24} className="text-[var(--color-text-muted)] mb-3" />
                        <p className="text-xs text-[var(--color-text-secondary)] font-medium">准备就绪</p>
                        <p className="text-[11px] text-[var(--color-text-muted)] mt-1 max-w-[200px]">
                          在左侧填写配置，然后点击 "执行工具" 查看控制台输出。
                        </p>
                      </div>
                    )}
                  </div>

                  {/* 最近一次调用统计 */}
                  {lastInvocation && (
                    <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-xl p-4 space-y-3">
                      <h4 className="text-xs font-semibold text-[var(--color-text-primary)] flex items-center gap-1.5">
                        <Clock size={12} className="text-[var(--color-accent)]" />
                        最近执行统计 ({lastInvocation.toolName})
                      </h4>
                      <div className="grid grid-cols-2 gap-3 text-[10px] font-mono text-[var(--color-text-secondary)]">
                        <div className="bg-[var(--color-bg-primary)] p-2.5 rounded-lg border border-[var(--color-border-muted)]">
                          <span className="text-[var(--color-text-muted)] block mb-1">执行状态</span>
                          <span className={lastInvocation.status === 'success' ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                            {lastInvocation.status === 'success' ? 'SUCCESS' : 'FAILED'}
                          </span>
                        </div>
                        <div className="bg-[var(--color-bg-primary)] p-2.5 rounded-lg border border-[var(--color-border-muted)]">
                          <span className="text-[var(--color-text-muted)] block mb-1">耗时</span>
                          <span className="text-[var(--color-text-primary)] font-bold">
                            {lastInvocation.durationMs !== undefined ? `${lastInvocation.durationMs.toFixed(0)} ms` : '--'}
                          </span>
                        </div>
                        <div className="bg-[var(--color-bg-primary)] p-2.5 rounded-lg border border-[var(--color-border-muted)] col-span-2">
                          <span className="text-[var(--color-text-muted)] block mb-1">Trace ID</span>
                          <span className="text-[var(--color-text-primary)] break-all select-text">
                            {lastInvocation.traceId || 'N/A'}
                          </span>
                        </div>
                        <div className="bg-[var(--color-bg-primary)] p-2.5 rounded-lg border border-[var(--color-border-muted)] col-span-2">
                          <span className="text-[var(--color-text-muted)] block mb-1">调用时间</span>
                          <span className="text-[var(--color-text-primary)]">
                            {new Date(lastInvocation.timestamp).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 select-none">
            <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-xl p-8 text-center max-w-sm shadow-xl">
              <div className="w-12 h-12 rounded-full bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] flex items-center justify-center mx-auto mb-4">
                <Wrench className="text-[var(--color-text-muted)]" size={20} />
              </div>
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">未选择工具</h3>
              <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                请在左侧列表中选择一个 RPC 工具以开始配置和触发调用。
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
