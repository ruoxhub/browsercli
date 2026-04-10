# Douyin a_bogus 逆向分析

## 调用链

```
URLSearchParams.append('a_bogus', value)
  ← d() [VM bytecode interpreter] at bdms.js:131912
    ← X(z[t], r, e, n) [VM dispatcher] at bdms.js:131083
      ← XMLHttpRequest.n [send] at bdms.js:130952
        ← 业务代码 (client-entry~3.b02f6ae6.js)
```

## 关键发现

1. **bdms.js** (v1.0.1.19-fix.01) 是字节跳动安全 SDK
2. 使用自定义 VM 字节码解释器执行 a_bogus 生成逻辑
3. 通过替换 `URLSearchParams.prototype.append` 在 XHR 发送前自动注入 a_bogus
4. `byted_acrawler.frontierSign` 生成的是 `X-Bogus`，不是 `a_bogus`
5. `securitySDK` 是主安全配置接口，但不直接生成 a_bogus

## a_bogus 格式

- 长度固定 ~180 字符 (URL编码后)
- 包含 Base64 编码部分
- 每次请求值都不同
- 是 URL 查询参数，非 Header

## 请求参数

resource/list 接口的请求参数包含:

- `spot_keys` - 动态变化（不同请求不同值）
- `app_id=6383`
- `pc_client_type=1`
- `msToken` - Cookie 中的动态 token
- `webid` - 设备 ID
- `uifid` - 用户标识
- 浏览器指纹参数 (screen, browser, os 等)
- `a_bogus` - 由 bdms.js VM 生成

## 实现策略

由于 a_bogus 依赖浏览器环境的 VM 字节码解释器，纯 Python/Node.js 还原成本极高。
最优方案：使用 CDP 连接已运行的浏览器实例，通过 `cdp_eval` 生成 a_bogus。
