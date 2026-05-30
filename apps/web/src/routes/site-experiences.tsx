import { useState, useEffect } from 'react';
import {
  Globe,
  Search,
  Plus,
  Edit3,
  Trash2,
  Calendar,
  Tag,
  FileText,
  AlertTriangle,
  CheckCircle2,
  X,
  Save,
  ChevronRight,
  Info,
} from 'lucide-react';
import { api } from '../lib/api';
import type { SiteExperience } from '../lib/protocol';

export default function SiteExperiencesPage() {
  const [experiences, setExperiences] = useState<SiteExperience[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // 选中的经验
  const [selectedId, setSelectedId] = useState<number | null>(null);
  
  // 编辑/新增模式状态： 'view' | 'edit' | 'create'
  const [mode, setMode] = useState<'view' | 'edit' | 'create'>('view');

  // 表单状态
  const [formDomain, setFormDomain] = useState('');
  const [formName, setFormName] = useState('');
  const [formAliases, setFormAliases] = useState<string[]>([]);
  const [aliasInput, setAliasInput] = useState('');
  const [formPlatformFeatures, setFormPlatformFeatures] = useState('');
  const [formValidPatterns, setFormValidPatterns] = useState('');
  const [formKnownPitfalls, setFormKnownPitfalls] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 获取站点经验列表
  const fetchExperiences = async (queryStr = searchQuery) => {
    setLoading(true);
    setError(null);
    try {
      // 模糊搜索或列出全部
      let response: SiteExperience[];
      if (queryStr.trim()) {
        // 分别尝试作为 name 或 url 搜索
        const results = await api.getSiteExperiences({
          url: queryStr.trim(),
          name: queryStr.trim(),
        });
        response = results;
      } else {
        response = await api.getSiteExperiences();
      }
      setExperiences(response);

      // 如果有数据且当前没有选中，或者选中的 ID 不在响应列表中，则默认选中第一个
      if (response.length > 0) {
        if (selectedId === null || !response.some(x => x.id === selectedId)) {
          setSelectedId(response[0].id);
          setMode('view');
        }
      } else {
        setSelectedId(null);
        setMode('view');
      }
    } catch (err) {
      console.error('Failed to fetch site experiences:', err);
      setError(err instanceof Error ? err.message : '获取站点经验失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExperiences();
  }, []);

  // 选中的经验对象
  const activeExp = experiences.find(e => e.id === selectedId) || null;

  // 当选中的经验变化时，如果处于 view 模式，更新表单值（方便点击编辑时能初始化）
  useEffect(() => {
    if (activeExp && mode === 'view') {
      setFormDomain(activeExp.domain);
      setFormName(activeExp.name);
      setFormAliases(activeExp.aliases || []);
      setFormPlatformFeatures(activeExp.platformFeatures || '');
      setFormValidPatterns(activeExp.validPatterns || '');
      setFormKnownPitfalls(activeExp.knownPitfalls || '');
    }
  }, [selectedId, activeExp, mode]);

  // 处理搜索
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchExperiences();
  };

  // 进入新增模式
  const handleEnterCreate = () => {
    setMode('create');
    setFormDomain('');
    setFormName('');
    setFormAliases([]);
    setAliasInput('');
    setFormPlatformFeatures('');
    setFormValidPatterns('');
    setFormKnownPitfalls('');
  };

  // 进入编辑模式
  const handleEnterEdit = () => {
    if (!activeExp) return;
    setMode('edit');
    setFormDomain(activeExp.domain);
    setFormName(activeExp.name);
    setFormAliases(activeExp.aliases || []);
    setAliasInput('');
    setFormPlatformFeatures(activeExp.platformFeatures || '');
    setFormValidPatterns(activeExp.validPatterns || '');
    setFormKnownPitfalls(activeExp.knownPitfalls || '');
  };

  // 退出编辑/新增返回详情查看
  const handleCancel = () => {
    setMode('view');
    if (activeExp) {
      setFormDomain(activeExp.domain);
      setFormName(activeExp.name);
      setFormAliases(activeExp.aliases || []);
      setFormPlatformFeatures(activeExp.platformFeatures || '');
      setFormValidPatterns(activeExp.validPatterns || '');
      setFormKnownPitfalls(activeExp.knownPitfalls || '');
    }
  };

  // 添加别名标签
  const handleAddAlias = (e?: React.KeyboardEvent) => {
    if (e && e.key !== 'Enter' && e.key !== ',') return;
    if (e) e.preventDefault();

    const tag = aliasInput.trim().replace(/,/g, '');
    if (tag && !formAliases.includes(tag)) {
      setFormAliases([...formAliases, tag]);
    }
    setAliasInput('');
  };

  // 删除别名标签
  const handleRemoveAlias = (tag: string) => {
    setFormAliases(formAliases.filter(a => a !== tag));
  };

  // 提交表单（保存新增或更新）
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formDomain.trim() || !formName.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      const data = {
        domain: formDomain.trim(),
        name: formName.trim(),
        aliases: formAliases,
        platformFeatures: formPlatformFeatures.trim() || null,
        validPatterns: formValidPatterns.trim() || null,
        knownPitfalls: formKnownPitfalls.trim() || null,
      };

      if (mode === 'create') {
        const created = await api.createSiteExperience(data);
        setExperiences([created, ...experiences]);
        setSelectedId(created.id);
        setMode('view');
      } else if (mode === 'edit' && selectedId !== null) {
        const updated = await api.updateSiteExperience(selectedId, data);
        setExperiences(experiences.map(e => e.id === selectedId ? updated : e));
        setMode('view');
      }
    } catch (err) {
      console.error('Failed to save experience:', err);
      setError(err instanceof Error ? err.message : '保存失败，请检查输入或后端状态');
    } finally {
      setSubmitting(false);
    }
  };

  // 删除站点经验
  const handleDelete = async (id: number) => {
    if (!window.confirm('确认删除该站点的经验记录吗？此操作不可撤销。')) return;

    setError(null);
    try {
      await api.deleteSiteExperience(id);
      const nextExperiences = experiences.filter(e => e.id !== id);
      setExperiences(nextExperiences);
      
      if (nextExperiences.length > 0) {
        setSelectedId(nextExperiences[0].id);
      } else {
        setSelectedId(null);
      }
      setMode('view');
    } catch (err) {
      console.error('Failed to delete experience:', err);
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  return (
    <div className="flex-1 flex flex-col md:flex-row h-full overflow-hidden select-none">
      {/* 左侧列表侧边栏 */}
      <div className="w-full md:w-80 border-r border-[var(--color-border-default)] flex flex-col bg-[var(--color-bg-secondary)]/50 backdrop-blur-md h-1/2 md:h-full shrink-0">
        {/* 顶部搜索与新增 */}
        <div className="p-4 border-b border-[var(--color-border-muted)] flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-[var(--color-text-primary)] tracking-wide flex items-center gap-2">
              <Globe className="text-[var(--color-accent)]" size={16} />
              站点经验板块
            </h2>
            <button
              onClick={handleEnterCreate}
              className="p-1.5 rounded-lg bg-[var(--color-accent)] text-[var(--color-bg-primary)] hover:opacity-90 active:scale-95 transition-all flex items-center justify-center"
              title="新增经验"
            >
              <Plus size={14} />
            </button>
          </div>

          <form onSubmit={handleSearchSubmit} className="relative">
            <input
              type="text"
              placeholder="按名称/域名检索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-4 py-1.5 rounded-lg text-xs bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none transition-all placeholder:text-[var(--color-text-muted)]"
            />
            <Search className="absolute left-2.5 top-2.5 text-[var(--color-text-muted)]" size={13} />
            {searchQuery && (
              <button
                type="button"
                onClick={() => { setSearchQuery(''); fetchExperiences(''); }}
                className="absolute right-2.5 top-2.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              >
                <X size={13} />
              </button>
            )}
          </form>
        </div>

        {/* 列表主体 */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {error && experiences.length === 0 && (
            <div className="p-3 text-xs rounded-lg border border-red-500/20 bg-red-500/5 text-[var(--color-accent-red)] flex items-start gap-2">
              <Info size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {loading && experiences.length === 0 ? (
            <div className="space-y-3 p-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-16 bg-[var(--color-bg-primary)]/40 border border-[var(--color-border-muted)] rounded-lg animate-pulse" />
              ))}
            </div>
          ) : experiences.length === 0 ? (
            <div className="text-center py-12 text-[var(--color-text-muted)] text-xs">
              暂无匹配的站点经验记录
            </div>
          ) : (
            experiences.map((exp) => (
              <div
                key={exp.id}
                onClick={() => { setSelectedId(exp.id); setMode('view'); }}
                className={`group flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all duration-200 ${
                  selectedId === exp.id
                    ? 'bg-[var(--color-bg-tertiary)] border-[var(--color-accent)]/50 shadow-[0_0_12px_rgba(88,166,255,0.05)]'
                    : 'bg-transparent border-[var(--color-border-muted)] hover:border-[var(--color-border-default)] hover:bg-[var(--color-bg-primary)]/30'
                }`}
              >
                <div className="min-w-0 flex-1 pr-2">
                  <h4 className="text-xs font-semibold text-[var(--color-text-primary)] truncate group-hover:text-[var(--color-accent)] transition-colors">
                    {exp.name}
                  </h4>
                  <p className="text-[10px] text-[var(--color-text-muted)] font-mono truncate mt-0.5">
                    {exp.domain}
                  </p>
                </div>
                <ChevronRight
                  size={12}
                  className={`text-[var(--color-text-muted)] transition-transform duration-200 ${
                    selectedId === exp.id ? 'translate-x-0.5 text-[var(--color-accent)]' : 'group-hover:translate-x-0.5'
                  }`}
                />
              </div>
            ))
          )}
        </div>
      </div>

      {/* 右侧主面板：详情展示 / 编辑表单 */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[var(--color-bg-primary)] h-1/2 md:h-full">
        {mode === 'view' ? (
          activeExp ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* 头部信息 */}
              <div className="p-6 border-b border-[var(--color-border-muted)] flex items-start justify-between gap-4">
                <div className="min-w-0 space-y-2">
                  <div className="flex items-center gap-3">
                    <h1 className="text-lg font-bold text-[var(--color-text-primary)] truncate">
                      {activeExp.name}
                    </h1>
                    <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] text-[10px] font-mono text-[var(--color-text-secondary)]">
                      ID: {activeExp.id}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)] font-mono">
                    <Globe size={12} className="text-[var(--color-accent)] shrink-0" />
                    <span className="truncate">{activeExp.domain}</span>
                  </div>

                  {/* 别名标签流 */}
                  {activeExp.aliases && activeExp.aliases.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {activeExp.aliases.map((alias, index) => (
                        <span
                          key={index}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--color-bg-tertiary)] border border-[var(--color-border-muted)] text-[10px] text-[var(--color-text-secondary)]"
                        >
                          <Tag size={8} />
                          {alias}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* 顶部操作按钮 */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={handleEnterEdit}
                    className="p-2 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] active:scale-95 transition-all flex items-center gap-1.5 text-xs font-medium"
                  >
                    <Edit3 size={13} className="text-[var(--color-accent)]" />
                    <span>编辑</span>
                  </button>
                  <button
                    onClick={() => handleDelete(activeExp.id)}
                    className="p-2 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] active:scale-95 transition-all flex items-center gap-1.5 text-xs font-medium hover:border-[var(--color-accent-red)]/30 hover:text-[var(--color-accent-red)]"
                  >
                    <Trash2 size={13} />
                    <span>删除</span>
                  </button>
                </div>
              </div>

              {/* 详情内容区 */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* 平台特征描述 */}
                <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-xl p-5 hover:border-[var(--color-accent)]/20 transition-colors relative overflow-hidden group">
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-[var(--color-accent)]" />
                  <div className="flex items-center gap-2 mb-3">
                    <FileText className="text-[var(--color-accent)]" size={15} />
                    <h3 className="text-xs font-bold text-[var(--color-text-primary)] tracking-wide">平台特征 (Platform Features)</h3>
                  </div>
                  {activeExp.platformFeatures ? (
                    <p className="text-xs leading-relaxed text-[var(--color-text-secondary)] whitespace-pre-wrap font-sans">
                      {activeExp.platformFeatures}
                    </p>
                  ) : (
                    <p className="text-xs text-[var(--color-text-muted)] italic">暂未录入该站点的平台特征信息</p>
                  )}
                </div>

                {/* 验证模式 */}
                <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-xl p-5 hover:border-[var(--color-status-green)]/20 transition-colors relative overflow-hidden group">
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-[var(--color-status-green)]" />
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle2 className="text-[var(--color-status-green)]" size={15} />
                    <h3 className="text-xs font-bold text-[var(--color-text-primary)] tracking-wide">验证模式 (Valid Patterns)</h3>
                  </div>
                  {activeExp.validPatterns ? (
                    <p className="text-xs leading-relaxed text-[var(--color-text-secondary)] whitespace-pre-wrap font-mono bg-[var(--color-bg-primary)] p-3 rounded-lg border border-[var(--color-border-muted)] select-text">
                      {activeExp.validPatterns}
                    </p>
                  ) : (
                    <p className="text-xs text-[var(--color-text-muted)] italic">暂未录入验证规则与核心加密特征</p>
                  )}
                </div>

                {/* 已知踩坑点 */}
                <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-xl p-5 hover:border-[var(--color-status-yellow)]/20 transition-colors relative overflow-hidden group">
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-[var(--color-status-yellow)]" />
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle className="text-[var(--color-status-yellow)]" size={15} />
                    <h3 className="text-xs font-bold text-[var(--color-text-primary)] tracking-wide">已知踩坑点 (Known Pitfalls)</h3>
                  </div>
                  {activeExp.knownPitfalls ? (
                    <p className="text-xs leading-relaxed text-[var(--color-text-secondary)] whitespace-pre-wrap font-sans">
                      {activeExp.knownPitfalls}
                    </p>
                  ) : (
                    <p className="text-xs text-[var(--color-text-muted)] italic">暂未录入该站点的反爬/反调试注意事项</p>
                  )}
                </div>

                {/* 时间戳 */}
                <div className="pt-4 border-t border-[var(--color-border-muted)] flex items-center justify-between text-[10px] text-[var(--color-text-muted)] font-mono">
                  <span className="flex items-center gap-1">
                    <Calendar size={11} />
                    创建于: {new Date(activeExp.createdAt).toLocaleString()}
                  </span>
                  <span>
                    更新于: {new Date(activeExp.updatedAt).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-[var(--color-text-muted)] space-y-4">
              <Globe size={48} className="opacity-20 animate-pulse text-[var(--color-accent)]" />
              <div>
                <h3 className="text-sm font-medium text-[var(--color-text-primary)]">暂无选择</h3>
                <p className="text-xs mt-1">请在左侧选择站点经验，或者点击右上角“+”按钮新建一条记录。</p>
              </div>
            </div>
          )
        ) : (
          /* 编辑或新增表单模式 */
          <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
            {/* 表单头部 */}
            <div className="p-6 border-b border-[var(--color-border-muted)] flex items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-bold text-[var(--color-text-primary)]">
                  {mode === 'create' ? '新建站点经验' : `编辑站点经验: ${activeExp?.name}`}
                </h2>
                <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
                  完善站点逆向经验细节，沉淀分析链路。
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="px-3 py-1.5 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] active:scale-95 transition-all text-xs font-medium"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={submitting || !formDomain.trim() || !formName.trim()}
                  className="px-3 py-1.5 rounded-lg bg-[var(--color-accent)] text-[var(--color-bg-primary)] hover:opacity-90 active:scale-95 transition-all text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Save size={13} />
                  {submitting ? '保存中...' : '保存'}
                </button>
              </div>
            </div>

            {/* 表单内容 */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {error && (
                <div className="p-3 text-xs rounded-lg border border-red-500/20 bg-red-500/5 text-[var(--color-accent-red)] flex items-start gap-2">
                  <Info size={14} className="shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {/* 基础输入行 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-[var(--color-text-secondary)] tracking-wide">
                    站点名称 <span className="text-[var(--color-accent-red)]">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. 京东 h5st"
                    className="w-full px-3 py-2 rounded-lg text-xs bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-[var(--color-text-secondary)] tracking-wide">
                    主要域名 <span className="text-[var(--color-accent-red)]">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    disabled={mode === 'edit'}
                    value={formDomain}
                    onChange={(e) => setFormDomain(e.target.value)}
                    placeholder="e.g. api.m.jd.com"
                    className="w-full px-3 py-2 rounded-lg text-xs bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
              </div>

              {/* 别名输入行 */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-[var(--color-text-secondary)] tracking-wide">
                  域名别名 (Aliases) - 回车或逗号分隔
                </label>
                <div className="w-full p-2 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] flex flex-wrap items-center gap-1.5">
                  {formAliases.map((alias, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 rounded-full bg-[var(--color-bg-tertiary)] border border-[var(--color-border-muted)] text-[10px] text-[var(--color-text-secondary)] font-mono"
                    >
                      {alias}
                      <button
                        type="button"
                        onClick={() => handleRemoveAlias(alias)}
                        className="p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-accent-red)] transition-colors"
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                  <input
                    type="text"
                    value={aliasInput}
                    onChange={(e) => setAliasInput(e.target.value)}
                    onKeyDown={handleAddAlias}
                    onBlur={() => handleAddAlias()}
                    placeholder={formAliases.length === 0 ? "e.g. m.jd.com, jd.com" : ""}
                    className="flex-1 min-w-[120px] bg-transparent border-none text-xs text-[var(--color-text-primary)] focus:outline-none placeholder:text-[var(--color-text-muted)]"
                  />
                </div>
              </div>

              {/* 平台特征描述 */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-[var(--color-text-secondary)] tracking-wide flex items-center gap-1">
                  <FileText size={12} />
                  平台特征 (Platform Features)
                </label>
                <textarea
                  value={formPlatformFeatures}
                  onChange={(e) => setFormPlatformFeatures(e.target.value)}
                  placeholder="详细描述目标站点的网络请求、业务参数特征或反逆向大环境结构（如：包含多款自研浏览器指纹校验，使用 Webpack 打包，使用 H5 签名）"
                  rows={4}
                  className="w-full px-3 py-2 rounded-lg text-xs bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none transition-all placeholder:text-[var(--color-text-muted)] resize-y min-h-[80px]"
                />
              </div>

              {/* 验证模式 */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-[var(--color-text-secondary)] tracking-wide flex items-center gap-1">
                  <CheckCircle2 size={12} />
                  验证模式与特征 (Valid Patterns)
                </label>
                <textarea
                  value={formValidPatterns}
                  onChange={(e) => setFormValidPatterns(e.target.value)}
                  placeholder="记录关键的签名参数匹配模式、生成规则。例如：&#10;1. _cv = 3.1&#10;2. h5st 格式: t;appId;sign;uuid;...&#10;3. 请求头包含 Authorization"
                  rows={4}
                  className="w-full px-3 py-2 rounded-lg text-xs bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none transition-all placeholder:text-[var(--color-text-muted)] font-mono resize-y min-h-[80px]"
                />
              </div>

              {/* 已知踩坑点 */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-[var(--color-text-secondary)] tracking-wide flex items-center gap-1">
                  <AlertTriangle size={12} />
                  已知踩坑点 (Known Pitfalls)
                </label>
                <textarea
                  value={formKnownPitfalls}
                  onChange={(e) => setFormKnownPitfalls(e.target.value)}
                  placeholder="记录曾经遭遇的蜜罐、封禁策略、检测面。如：&#10;1. 检测 window.navigator.webdriver&#10;2. CDP 被环境监测（需要 stealth 插件）&#10;3. 封禁频次阀值为 10 次/秒，封禁时间 1 小时"
                  rows={4}
                  className="w-full px-3 py-2 rounded-lg text-xs bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none transition-all placeholder:text-[var(--color-text-muted)] resize-y min-h-[80px]"
                />
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
