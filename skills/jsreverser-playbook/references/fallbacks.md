# 失败回退

## 一般回退

- Hook 无数据：确认动作执行 -> 扩一档范围 -> 仍失败则停，不要直接猜 local rebuild。
- 如果 Hook 错过首屏初始化：回到页面入口，先补 `inject_preload_script` 再重试。
- 数据过多：summary 去噪 -> raw 单条下钻。
- 本地补环境失败：先读代理 env log，确认当前 `first divergence`，再回看页面证据；`diff_env_requirements` 仅作辅助。
- local rebuild 连续两轮无进展：回到页面观察，补 `record_reverse_evidence` 后再继续。
- 断点不稳：回退 Hook 路径。

## 防护站点（Cloudflare / WAF / 反爬）

当目标站点有较强防护（Cloudflare 质询、WAF 拦截、浏览器指纹检测）时，Hook 和调试器路径可能完全不可用。此时不要反复在 Hook 上试错，按此决策分支走：

```
观察受阻（页面空白 / 跳转 / 质询页面 / WebSocket 断开）
  │
  ├─ 检查页面是否加载了目标 JS
  │   ├─ 是 → 尝试 inject_preload_script 在首屏前注入
  │   └─ 否 → 防护拦截了脚本加载
  │
  ├─ 能否绕过防护？
  │   ├─ 尝试设置合适的 User-Agent / inject_stealth
  │   ├─ 尝试 emulate_mobile 切换指纹
  │   └─ 仍被拦截 → 放弃在线 Hook
  │
  └─ 放弃在线 Hook，切到离线分析路径：
      ├─ 抓包离线分析（Charles / Fiddler / Wireshark）
      │   - 捕获 HTTPS 流量（需安装 CA 证书）
      │   - 分析请求参数、签名算法线索
      │
      ├─ 开源代码分析
      │   - 从 CDN / npm 下载目标库源码
      │   - 或从页面 SourceMap（如有泄露）提取
      │
      ├─ 历史缓存分析
      │   - 如之前有保存的页面快照或任务 artifact，从中提取
      │
      └─ 动态插桩（极端情况）
          - 如果能拿到 JS bundle，在本地 Node 补环境运行
          - 参考 `references/local-rebuild.md` 的离线模式
```

关键原则：**如果页面连脚本都无法加载，不要继续在 Hook 上消耗时间，立即切到离线路径。**
