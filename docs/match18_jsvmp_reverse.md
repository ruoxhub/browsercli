---
title: '【逆向记录】猿人学 match/18「jsvmp 洞察先机」'
created: 2026-08-17
description: '基于 Reverser-CLI + jsvmp-reverse skill 的完整逆向过程：jssvmzl VM 识别、token 参数还原（t+v）、物理轨迹校验、UA 校验与数据求和提交。'
tags:
  - 'jsvmp'
  - 'reverser-cli'
  - 'yuanrenxue'
---

> 分析日期：2026-08-17
> 分析目标：猿人学逆向练习平台 第十八题「jsvmp 洞察先机」
> 数据接口：`/api/v/question/18data?page=N`
> 提交接口：`/a/18`
> 关键脚本：页面内联脚本中的 `jssvmzl:ver.1.1.3` VM

---

## 结论速览

- 数据接口 `18data` 对 `page=1` 放行，`page>=2` 需要 token。
- token 由 **`t` + `v` 两个参数** 构成（页面代码里的 `m` 参数是**刻意误导**）：
  - `t` = 秒级时间戳（十进制）
  - `v` = `myenc('page|轨迹', key)`，其中 `key` = 秒级时间戳的 hex 补 8 位后重复两次
- `myenc` 是 jssvmzl VM 运行时解密出的确定性加密函数（标准 AES/DES 均不匹配，自定义算法）。
- `v` 的轨迹字段必须由**真实鼠标事件**（物理点击）产生，JS `dispatchEvent` 模拟的轨迹会被服务端拒绝。
- 第 5 页额外要求请求头 `User-Agent` 精确等于 `yuanrenxue`。
- 数据随**登录用户**变化，必须携带已登录的 `sessionid`。
- 5 页数据求和 = **28287398**，提交 `/a/18` 返回 `success`。

---

## 第一阶段：观察与接口定位（Observe-first）

### 1.1 接口行为

直接请求数据接口观察行为差异：

```text
GET /api/v/question/18data?page=1
=> 200 {"data": [361759, 732301, ...]}

GET /api/v/question/18data?page=2
=> 400 {"error": "token failed"}
```

结论：`page=1` 无需 token，`page>=2` 必须携带有效 token。

### 1.2 页面脚本结构

页面内联脚本（按 DOM 顺序）：

| 脚本 | 内容 | 结论 |
|------|------|------|
| #6 | 百度统计 | 无关 |
| #8 | 移动端逻辑 | 无关 |
| #11 | `$.ajax` 拦截器，拦截 `url === "/api/match/18"` 并取 `data.m` 存到 `window.match18` | **误导项** |
| #12 | `submit` 提交逻辑 | 无关 |
| #13 | `jssvmzl:ver.1.1.3` VM | 核心保护 |
| #14 | `req()/getdata()` 数据请求逻辑 | 入口 |

### 1.3 关键误导：脚本 #11 的 `m` 拦截器

```js
let _ajax = $.ajax
$.ajax = function (){
    if (arguments[0].url === "/api/match/18"){
        window.match18 = arguments[0].data.m   // 只存不转发
    }
    else {
        _ajax.apply(this, arguments)
    }
}
```

初看像是「m 参数通过 `/api/match/18` 传递」。但实测：

- `/api/match/18` 返回 404（接口不存在）
- 页面加载全程**没有**任何代码调用 `$.ajax({url:'/api/match/18'})`
- `window.match18` 始终为 `undefined`

**结论：`m` 是烟幕弹，真实 token 参数名是 `t` + `v`（见下文）。**

### 1.4 脚本 #14 的请求逻辑

```js
function req(np){
    p=Math.min(TP,Math.max(1,np)); ui();
    window.request&&window.request();            // VM 定义的 request
    var d={page:p,pageSize:PS,kw:...,m:window.match18};  // 仅调试展示用
    ...
    function getdata(page){
        var xml = new XMLHttpRequest();
        ...
        xml.open('GET', '/api/v/question/18data?page=' + page, true);
        xml.send();
    }
    getdata(p);
}
```

`getdata` 的 XHR 请求 URL 里**没有 token**——这解释了页面自身翻页必然失败。

---

## 第二阶段：VM 识别与关键发现

### 2.1 VM 类型

脚本 #13 使用 `jssvmzl:ver.1.1.3` 框架。与常见的 `while(true)+switch` 型 VM 不同，它采用**数组函数表分派**：

```text
取指模式：B[Codes[PC++]]  → 从指令函数表取处理函数并执行
调度方式：递归调用 __V，无大 switch
```

这导致 `analyze_jsvmp_vm` 与 `JSVMPDeobfuscator` 的 `switch(case>10)` 特征检测**双双漏检**（均返回 `isJsvmp: false`）。

### 2.2 VM 劫持 XHR（反调试）

VM 在运行时把 `XMLHttpRequest.prototype.open/send` 替换成 VM 解释器函数 `y__`，破坏页面 `getdata` 的请求：

```text
getdata 调用 xml.open(...) → 实际执行 VM 的 y__ → 生成 token 但未正确设置 readyState
→ xml.send() 抛错：Failed to execute 'send': The object's state must be OPENED.
```

因此**页面自身翻页必然失败**（请求根本没发出）。

### 2.3 从成功请求反推 token 参数

绕过 VM 劫持（保存原生 `open/send` 引用后物理点击翻页），观察成功请求的 URL：

```text
GET /api/v/question/18data?page=2&t=1786902407&v=OT4%2FpfCQEmTkIAPFNhKeQDRAD15YfGz34SoRRmEzpsgmIdHxTzDVDBuRluGQA5Ga
```

真实参数是 **`t` + `v`**，不是 `m`。

---

## 第三阶段：token 生成算法还原

### 3.1 定位加密函数 `myenc`

VM 运行时在 `window` 上解密出若干函数，其中 `myenc` 是确定性加密函数：

```js
// 确定性验证
myenc('2|', '6a81f1236a81f123') === myenc('2|', '6a81f1236a81f123')  // true
```

`myenc` 输出为 base64（分组加密，标准 AES/DES/3DES/Blowfish/RC4 均不匹配，属自定义算法）。

### 3.2 通过 hook 还原参数关系

物理点击翻页时 hook `myenc`，同步抓取请求 URL 对比：

```text
hook 捕获：myenc('2|422d360,422u360', '6a81f7dd6a81f7dd')
              => 'MPvw2jCmLdYemfh4amevyqnllUFCoqARpI1Up1k8nQ0='

请求 URL：  page=2&t=1786902493&v=MPvw2jCmLdYemfh4amevyqnllUFCoqARpI1Up1k8nQ0%3D
```

**对应关系完全确定：**

- `v` = `myenc` 的返回值
- `t` = 1786902493（秒级时间戳）
- `key` = `6a81f7dd` = `1786902493` 的十六进制
- `myenc` 第二个参数 = `key + key`（hex 重复两次）
- `myenc` 第一个参数 = `page + '|' + 轨迹`，轨迹形如 `422d360,422u360`（`d`/`u` 表示移动方向）

### 3.3 token 生成公式

```text
t   = Math.floor(Date.now() / 1000)                    // 秒级时间戳（Date.now 已被 VM 重写为走 /api/getTime 服务器时间）
key = t.toString(16).padStart(8, '0')                  // 8 位 hex
v   = myenc(page + '|' + 轨迹, key + key)              // key 重复两次
请求 = /api/v/question/18data?page=N&t=<t>&v=<encodeURIComponent(v)>
```

---

## 第四阶段：物理交互与轨迹校验

### 4.1 JS 模拟事件被拒绝

用 `document.dispatchEvent(new MouseEvent('mousemove', ...))` 模拟轨迹，生成的 `v` 请求后仍返回 `token failed`。

### 4.2 物理点击才是有效路径

用 `click_at`（真实 CDP 鼠标事件）点击翻页按钮，轨迹由浏览器真实输入产生，token 被服务端接受。

关键差异：**物理点击产生的轨迹格式为 `422d360,422u360`（d/u 方向标记），而 JS 模拟产生的是 `410m721`（m 标记），后者被拒绝。**

---

## 第五阶段：第 5 页的 UA 校验

第 5 页请求返回特殊提示数据而非 token failed：

```text
GET /api/v/question/18data?page=5
=> 200 {"data": ["请","将","UA","改","为","yuan","ren","xue","哦"]}
```

需设置请求头 `User-Agent: yuanrenxue`（精确等于）。校验顺序为：**先校验 UA，再校验 token**（UA 通过后才报 token failed）。

注意：纯 `yuanrenxue` 会让 VM 环境检测异常（不生成 token），因此用 `set_user_agent` 全局设置后，手动构造 `t/v` 发起请求即可。

---

## 第六阶段：登录态与数据获取

### 6.1 数据随登录用户变化

未登录 session 与已登录 session 返回的 `page=1` 数据不同：

```text
未登录 page=1: [361759, 732301, ...]
已登录 page=1: [443859, 519874, ...]
```

提交答案必须使用**已登录用户**的数据。

### 6.2 设置登录态

将已登录的 `sessionid` 写入 `document.cookie`（会话 cookie 非 HttpOnly）：

```js
document.cookie = 'sessionid=<SESSION_ID>; path=/; domain=.yuanrenxue.cn';
// 验证
fetch('/api/user') => {"isLogin": true, "nickname": "猿人学-519324d7"}
```

### 6.3 统一获取 5 页数据

```js
async function getPage(page) {
  const sec = Math.floor(Date.now() / 1000);
  const key = sec.toString(16).padStart(8, '0');
  const v = myenc(page + '|422d360,422u360', key + key);
  return fetch(`/api/v/question/18data?page=${page}&t=${sec}&v=${encodeURIComponent(v)}`);
}
```

---

## 第七阶段：求和与提交

### 7.1 5 页数据

| 页 | 数据 | 页和 |
|----|------|------|
| 1 | 443859, 519874, 696227, 289848, 676086, 227036, 572798, 568081, 193090, 951787 | 5138686 |
| 2 | 254560, 465764, 239172, 200924, 270193, 397417, 715013, 337087, 774098, 608993 | 4263221 |
| 3 | 339215, 429078, 283945, 706075, 763276, 402753, 991312, 939695, 945468, 295551 | 6096368 |
| 4 | 819647, 731573, 652522, 412370, 636622, 671403, 336664, 743116, 495319, 468047 | 5967283 |
| 5 | 976047, 738641, 935329, 145744, 992698, 932639, 444448, 336603, 469483, 850208 | 6821840 |

**总和 = 28287398**

### 7.2 提交

```text
POST /a/18  body: answer=28287398
=> {"result":"success","created":true,"code":2,"exp":500}
```

---

## 技术总结

### 完整流程

```text
1. 观察接口：page=1 放行，page>=2 需要 token
   ↓
2. 识别 VM：jssvmzl 数组函数表分派（analyze_jsvmp_vm 漏检）
   ↓
3. 发现 VM 劫持 XHR 反调试 → 保存原生 XHR 引用绕过
   ↓
4. 物理点击翻页 → 观察成功请求 URL → 反推 token 参数为 t + v
   ↓
5. hook myenc 还原参数：v = myenc(page|轨迹, key)，key = 秒时间戳 hex 重复
   ↓
6. 确认轨迹需真实鼠标事件（dispatchEvent 模拟被拒）
   ↓
7. 第 5 页需 UA = yuanrenxue
   ↓
8. 设置已登录 sessionid → 手动构造 t/v 获取 5 页数据
   ↓
9. 求和 28287398 → 提交成功
```

### 关键参数表

| 参数 | 含义 | 生成方式 |
|------|------|----------|
| `t` | 秒级时间戳 | `Math.floor(Date.now()/1000)`（Date.now 走服务器时间） |
| `v` | 加密 token | `myenc(page + '|' + 轨迹, key)` |
| `key` | 加密密钥 | `t.toString(16).padStart(8,'0')` 重复两次 |
| 轨迹 | 鼠标轨迹 | 真实鼠标事件（`d`/`u` 方向标记），非 JS 模拟 |

### 死胡同记录

1. **误以为 token 参数是 `m`** —— 脚本 #11 拦截器与 `window.match18` 是刻意误导，真实参数是 `t` + `v`。
2. **在 Node 中 mock 浏览器环境跑 VM 期望解密出函数** —— VM 无任何副作用，因为环境检测短路；必须靠**运行时 hook** 捕获解密产物。
3. **用 `dispatchEvent` 模拟 mousemove** —— 轨迹格式（`m` 标记）被服务端拒绝，必须物理点击。
4. **用未登录 session 获取数据求和提交** —— 返回 `wrong answer`，数据随登录用户变化。
5. **反复用 `myenc('2|', key)` 作为 `?m=` 请求** —— 参数名和轨迹格式都不对，正确是 `t` + `v` 且 `v` 明文含 `|轨迹`。

### 对 skill / 工具的改进点

1. `analyze_jsvmp_vm` 对「数组函数表分派、无大 switch」的 jssvmzl 型 VM 漏检，需独立识别取指自增表达式 + 指令函数表，而非强依赖 `switch(case>10)`。
2. skill 缺少「运行时探针捕获解密产物函数」路径（字节码解释器型 VM 静态 AST 看不到解密后的 `myenc`）。
3. skill 缺少「从成功/失败请求 URL 差异反推 token 参数」的 Observe-first 步骤。
4. skill 缺少「物理交互（click_at 等）产生合法轨迹」的说明，JS 模拟事件无效。
5. skill 缺少「token 之外还需特定 header/UA」的参数级反爬场景。
6. `evaluate_script` 在 VM 劫持 XHR 后会超时，需明确超时分类与错误提示。
7. `get_script_source --filePath` 保存 VM 源码存在截断问题。
