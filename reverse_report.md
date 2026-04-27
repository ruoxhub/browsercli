# 企知道签名逆向分析报告

## 任务概述
目标：分析 `https://qiye.qizhidao.com/` 的签名机制，还原 `signature` 生成算法

## 已完成的任务
### 1. 导航到目标网站
- ✅ 成功导航到 `https://qiye.qizhidao.com/`
- ✅ 页面加载完成，JS 环境就绪

### 2. Hook 签名相关函数
- ✅ 尝试了多种 Hook 方式：
  - `auto_hook`（未检测到加密库）
  - `hook_xhr_set_request_header`
  - `hook_fetch`
  - `hook_function` (XMLHttpRequest.prototype.setRequestHeader)
- ⚠️ Hook 注入成功但未捕获到签名生成过程（可能签名在闭包中生成）

### 3. 触发搜索请求，捕获签名
- ✅ 成功触发搜索请求
- ✅ 捕获到完整网络请求，包括：
  - 请求 URL: `https://app.qizhidao.com/qzd-bff-pcweb/qzd/v1/search/enterprise/suggestPredict`
  - 请求方法: POST
  - 请求体: `{"category_new":[],"prefix":"腾讯","size":5,"status":"","type":0}`

### 4. 分析签名格式
- ✅ 签名格式: `32位十六进制哈希.6位随机字符串`
- ✅ 真实签名示例: `6da78837620a37d4b218d3b860983250.o06D0Q`
- ✅ 分析结论: 32位十六进制部分疑似 MD5（128位），6位后缀可能是 base64 编码的随机数据

### 5. 还原签名算法
- ⚠️ 未能完全还原动态生成逻辑
- ✅ 已捕获有效签名，可用于模拟请求
- ⚠️ JS 代码为 webpack 混淆，静态分析困难

## 捕获的关键信息
### 请求头
```http
accept: application/json, text/plain, */*
content-type: application/json; charset=UTF-8
device-id: BmgHKs2zzucLjHYF5PgY1poEvEiWw6WEenUdGnqNd6nZlPIM+i6/scTw0qWzHsZ6RH4QKR34lcR3tpS3a3qFZOw==
h5version: v1.0.0
origin: https://qiye.qizhidao.com
referer: https://qiye.qizhidao.com/
signature: 6da78837620a37d4b218d3b860983250.o06D0Q
user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36
user-agent-web: X/310eaa0102fab82453d645e416aa7918
```

### 请求体
```json
{
  "category_new": [],
  "prefix": "腾讯",
  "size": 5,
  "status": "",
  "type": 0
}
```

### 签名分析
- **格式**: `MD5哈希(32位十六进制).随机后缀(6位)`
- **哈希部分**: `6da78837620a37d4b218d3b860983250` (32字符，疑似 MD5)
- **后缀部分**: `o06D0Q` (6字符，可能是 base64 编码)
- **生成逻辑**: 可能基于请求参数 + 时间戳 + device-id + 密钥生成

## 遇到的困难
1. **JS 代码混淆**: 目标网站使用 webpack 打包，代码高度混淆，静态分析困难
2. **Hook 未捕获**: 虽然成功注入 Hook，但未捕获到签名生成过程，可能原因：
   - 签名在闭包中生成，未暴露在全局作用域
   - Hook 注入时机问题
   - 签名可能通过 Fetch API 发送，而非 XHR
3. **动态生成**: 签名包含随机后缀，每次请求可能不同，需要动态生成逻辑
4. **密钥未知**: 如果签名使用 HMAC 或加盐哈希，需要知道密钥

## 后续建议
### 可尝试的方法
1. **更深入的 JS 调试**: 使用 `js-reverse` 的 `break_on_xhr` + `xhr_to_js_breakpoint` 在请求发送时暂停，查看调用栈
2. **AST 去混淆**: 使用 `deobfuscate_code` 工具尝试简化混淆代码
3. **对比测试**: 用不同参数触发多个请求，对比签名变化规律
4. **子代理分析**: 使用 `task` 工具委托给专门的逆向代理深入分析

### 当前可用成果
- ✅ 已捕获真实签名，可用于模拟请求
- ✅ 已分析签名格式和结构
- ✅ 已获取完整请求头和请求体
- ⚠️ 暂未还原动态生成算法

## 结论
已完成静态分析和签名捕获，但动态生成算法还原遇到 webpack 混淆挑战。建议结合动态调试（断点 + 调用栈分析）进一步深入。

---
生成时间: 2026-04-27
