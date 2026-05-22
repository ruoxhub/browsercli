## js-reverse CLI 常见问题排障指南
  ──────
  ## 🔧 第一类：Worker 与服务启动问题

  ### P1.1  WORKER_ALREADY_RUNNING  — Worker 已在运行无法重启

  现象

    error: Worker 已经在运行中
    code: WORKER_ALREADY_RUNNING
                                                                                                                                                                         
  诊断                                                                                                                                                                                                                                                                                                   
    js-reverse status
    # 查看 running / pid / workerHealth 状态

  解决步骤

    # 1. 先停止再启动，不要直接 start
    js-reverse stop
    js-reverse start

    # 2. 若 stop 无效（守护进程失联），强杀 node
    taskkill /f /im node.exe      # Windows
    pkill -f "js-reverse"         # Linux/macOS
  ──────
  ### P1.2 浏览器实例崩溃后 CDP 连接中断

  现象

    browserContext.newPage: Target page, context or browser has been closed

  诊断

    js-reverse call check_browser_health
    js-reverse call list_pages     # 返回 "当前没有打开的页面"

  解决步骤

    # 1. 清理残留 Chrome 进程
    taskkill /f /im chrome.exe     # Windows
    pkill chrome                   # Linux/macOS

    # 2. 重启 Worker（会自动重启浏览器）
    js-reverse stop
    js-reverse start

    # 3. 若仍然崩溃，清理 user-data-dir 里的 Lock 文件
    # Chrome 数据目录（见启动参数 --user-data-dir）
    del "E:\tmp\chrome-mcp\SingletonLock"

  │ 根本原因：js-reverse 启动的 Chrome 没有  --crash-on-failure 
  │ 保护，进程被强杀后
  │ CDP WebSocket 断开，Worker 无法自动重连已关闭的 browserContext。
  ──────
  ## 🌐 第二类：RPC 请求路由问题

  ### P2.1  -1400  请求被服务器拒绝 / 路由到错误 Tab

  现象

    { "code": "-1400", "msg": "出错了（400）！", "flag": 0 }

  诊断流程

    # Step 1: 查看当前所有 Tab
    js-reverse call list_pages

    # Step 2: 确认 onlineClients 数量
    js-reverse status
    # → onlineClients: 2  ← 说明有两个同 group 客户端抢占请求

  原因分析

  Sekiro RPC 服务对同一  group  下的多个  clientId 
  采用负载均衡/随机路由。若同时有多个猎聘标签页注册了同一个  group=liepin 
  ，请求可能被路由到 Cookie/Session 不匹配 的旧 Tab，导致 400。

  解决步骤

    # 1. 将多余的同域 Tab 导航走，断开其 RPC 注册
    js-reverse call select_page --pageIdx 0    # 选中多余的旧 Tab
    js-reverse call navigate_page --url about:blank   # 断开该 Tab 与 group
  的连接

    # 2. 激活正确的 Tab
    js-reverse call select_page --pageIdx 1

    # 3. 再次运行测试确认
    python tests\liepin.py --action search
  ──────
  ### P2.2 POST Body 格式错误（ [object Object]  被发送到服务器）

  现象

  请求到达服务器后，Body 不是 JSON 字符串，而是  [object Object] 
  ，服务器报参数解析失败。

  诊断

    # 在浏览器 DevTools Network 面板中抓包对比
    # 或注入脚本打印 body
    js-reverse call evaluate_script --function "() => {
      const orig = window.fetch;
      window.fetch = function(url, opts) {
        console.log('body:', opts?.body);
        return orig.apply(this, arguments);
      }
    }"

  根本原因

   lib/http.js  中  fetchPost  的  Options.bodyType  默认为  'text' ，此时
  body 通过  URLSearchParams  序列化，导致嵌套对象变成  [object Object] 。

  解决方案

    // content/<platform>/api.js
    // 错误写法：
    return fetchPost(url, searchParams, headers, Options);

    // 正确写法：强制 JSON 序列化
    return fetchPost(url, searchParams, headers, Object.assign({}, Options, {
  bodyType: 'json' }));
  ──────
  ## 📜 第三类：脚本执行与上下文问题

  ### P3.1  evaluate_script  报 frameId 失效

  现象

    脚本执行失败：显式指定的 frameId=XXX 未在 page 上下文中命中

  原因：每次页面导航/刷新，Chromium 都会为新 Document 分配全新的  frameId 
  ，硬编码的 ID 立即失效。

  解决步骤

    # 1. 动态获取当前最新 frameId
    js-reverse call list_frames
    # 返回示例：
    # frameId=75D323FA4D20EB90A22A8D0DB1C16F51  origin=https://www.liepin.com

    # 2. 使用最新 frameId 执行
    # params.json:
    # { "function": "() => window.__liepin.searchJob.toString()", "frameId":
  "75D323..." }
    js-reverse call evaluate_script --file params.json

    # 3. 或者放弃固定 frameId，使用 allowAnyFrame 降级模式
    # { "function": "() => ...", "allowAnyFrame": true }
  ──────
  ### P3.2  ISOLATED  World 与  MAIN  World 访问冲突

  现象

    执行失败：目标对象可能位于扩展 content script 隔离上下文，
    页面主上下文无法直接访问；请改用 --context content-script

  原理

   World         │ 运行位置              │ 能访问什么
  ───────────────┼───────────────────────┼───────────────────────────────────
    MAIN         │ 页面原生 JS 环境      │  window.__liepin 、页面全局变量
    ISOLATED     │ 扩展 Content Script   │  chrome.runtime 、扩展 API

  解决步骤

    # 访问页面 window 上的变量 → context: page（MAIN world）
    js-reverse call evaluate_script \
      --function "() => window.__liepin.skId" \
      --frameId "75D323FA4D20EB90A22A8D0DB1C16F51"
      # 不传 context 或传 context=page

    # 访问扩展内部状态 → context: content-script（ISOLATED world）
    js-reverse call evaluate_script \
      --function "() => chrome.runtime.id" \
      --context content-script
  ──────
  ### P3.3 修改源文件后浏览器仍执行旧代码（扩展缓存问题）

  现象

  修改了  content/liepin/api.js  并保存，但  evaluate_script 
  打印出的函数体仍是旧代码。

  诊断

    # 打印当前页面内存中的函数源码
    # params.json: { "function": "() => window.__liepin.searchJob.toString()"
  }
    js-reverse call evaluate_script --file params.json
    # → 对比本地文件，如不一致则确认为扩展缓存问题

  解决步骤（三选一，按成本从低到高）

    # 方案 A：重启浏览器（最彻底）
    taskkill /f /im chrome.exe
    js-reverse stop && js-reverse start
    js-reverse call new_page --url https://www.liepin.com/zhaopin/

    # 方案 B：内存注入覆盖（不重启，适合快速迭代）
    # inject_override.json:
    # { "function": "() => { window.__liepin.searchJob = function(params){...
  新逻辑...} }" }
    js-reverse call evaluate_script --file inject_override.json

    # 方案 C：使用持久化预加载脚本（页面刷新后自动重新注入）
    js-reverse call inject_preload_script --script "window.__myOverride =
  true;"
    js-reverse call navigate_page --type reload
  ──────
  ## 🪝 第四类：Hook 注入问题

  ### P4.1 首屏请求在 Hook 注册前就已发出，无法捕获

  现象

   hook_fetch  或  hook_xhr_open 
  正常工作，但目标签名请求（通常在页面初始化时发出）始终捕获不到。

  原因

   content_scripts  默认注入时机是  document_idle （DOM
  加载完成后），而目标请求早在  document_start  阶段就已发出。

  解决步骤

    # 方案 A：使用 persistent Hook（CDP Page.
  addScriptToEvaluateOnNewDocument）
    # 会在任何 JS 执行之前挂载，不受注入时机限制
    js-reverse call inject_hook \
      --hookId "fetch-interceptor" \
      --script "window._fetchLog=[];const o=fetch;fetch=function(...
  a){console.log('[HOOK]',a[0]);_fetchLog.push(a[0]);return o.apply(this,a)};
  " \
      --persistent true

    # 方案 B：先注入 preload，再导航
    js-reverse call inject_preload_script \
      --preset "stealth"        # 内置预设，包含 fetch/xhr hook

    js-reverse call navigate_page --url https://target.com
  ──────
  ### P4.2 Hook 引发性能崩溃（页面卡死/内存暴涨）

  现象

  注入  auto_hook  或  trace_function  后，浏览器 CPU 飙至 100%，页面无响应。

  诊断

    js-reverse call get_performance_metrics
    # 关注：JSHeapUsedSize、ScriptDuration

  解决步骤

    # 1. 精准化 Hook，添加 URL 过滤
    js-reverse call hook_fetch --urlFilter "api-c.liepin.com"
    # 而非 hook_fetch（拦截全部 fetch）

    # 2. 避免对高频函数挂 trace（如 requestAnimationFrame 回调）
    # 使用 condition 参数过滤触发条件
    js-reverse call create_hook \
      --type function \
      --condition '["args[0]?.keyword !== undefined"]'

    # 3. 及时清理不需要的 Hook
    js-reverse call remove_hook --hookId "fetch-interceptor"

    # 4. 使用 observe_flow 代替手动组合 Hook（内置防爆保护）
    js-reverse call observe_flow --url https://target.com --mode priority
  ──────
  ## 🛡️  第五类：反检测与风控问题

  ### P5.1  navigator.webdriver = true  触发人机验证

  现象

  自动化操作时频繁触发滑块验证码，或 API 请求直接返回 403/风控拦截。

  诊断

    js-reverse call evaluate_script \
      --function "() => ({
        webdriver: navigator.webdriver,
        plugins: navigator.plugins.length,
        languages: navigator.languages
      })"
    # webdriver: true → 自动化特征暴露

  解决步骤

    # 1. 注入反检测套件（启动时自动挂载）
    js-reverse call inject_stealth --preset default

    # 2. 使用一键反调试
    js-reverse call anti_anti_debug

    # 3. 对 APM 上报接口做拦截（阻止风控收集 JS 指纹）
    # background.js 中的 declarativeNetRequest 规则
    # 参考本仓库 background/background.js 中的 APM blocking 逻辑
  ──────
  ## ⚙️ 第六类：配置与参数问题

  ### P6.1 配置文件不生效 / JSON 语法损坏

  诊断

    js-reverse config --list        # 查看所有配置文件路径及优先级
    js-reverse config               # 查看当前生效的完整配置

  解决步骤

    # 重置并重新初始化
    js-reverse config --init

    # 手动设定关键参数
    js-reverse config --set rpcHost=ws://127.0.0.1:5612
    js-reverse config --set browser.headless=false

  ### P6.2 PowerShell 下  --data  参数 JSON 转义失败

  现象

    # 这条命令在 PowerShell 下会报 JSON 解析错误
    js-reverse call auto_hook --data '{"preset":"network-core"}'

  解决步骤

    # 推荐方案：用 --file 替代内联 JSON，彻底规避转义问题
    # params.json:
    # { "preset": "network-core", "autoInject": true }
    js-reverse call auto_hook --file .\params.json
  ──────
  ## 📋 快速排障决策树

    请求返回错误
    ├── code: -1400 → [P2.1] 多 Tab 路由冲突
    ├── Body 格式错误 → [P2.2] bodyType 未设为 json
    └── 其他服务器错误 → 检查 Cookie/XSRF-TOKEN 是否过期

    evaluate_script 失败
    ├── frameId 未命中 → [P3.1] 页面刷新后 frameId 变更
    ├── 隔离上下文错误 → [P3.2] MAIN/ISOLATED world 混用
    └── 函数执行旧代码 → [P3.3] 扩展缓存，需重启浏览器

    Worker 启动失败
    ├── WORKER_ALREADY_RUNNING → [P1.1] stop 后再 start
    └── Target Closed → [P1.2] 清理 Chrome 进程后重启

    Hook 不生效
    ├── 首屏请求捕获不到 → [P4.1] 使用 persistent=true
    └── 页面卡死 → [P4.2] 缩小 Hook 范围，及时 remove_hook