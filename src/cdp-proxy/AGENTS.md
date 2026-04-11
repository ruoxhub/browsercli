# CDP Proxy

## OVERVIEW

HTTP API 服务器，将 Chrome DevTools Protocol 封装为 REST 风格接口，供外部脚本化控制浏览器。

## WHERE TO LOOK

| Task        | Location                  | Notes                           |
| ----------- | ------------------------- | ------------------------------- |
| 核心类      | `CdpProxy.ts`             | 唯一源文件，包含全部端点逻辑    |
| 初始化      | `initializeWithBrowser()` | MCP 启动时注入现有 Browser 实例 |
| 独立模式    | `connectToBrowser()`      | 通过 `browserURL` 自行连接      |
| 端点路由    | `handleRequest()`         | 集中分发，GET/POST 混用         |
| Target 解析 | `getPageByTargetId()`     | 所有操作页面的前置步骤          |
| 端口配置    | `CDP_PROXY_PORT` 环境变量 | 默认 `3456`                     |

## ENDPOINTS

| 端点          | 方法 | 参数                                   | 说明                                   |
| ------------- | ---- | -------------------------------------- | -------------------------------------- |
| `/health`     | GET  | 无                                     | 健康检查，无需浏览器连接               |
| `/targets`    | GET  | 无                                     | 列出所有 page 类型 target              |
| `/new`        | GET  | `url`                                  | 创建新 tab，默认 `about:blank`         |
| `/close`      | GET  | `target`                               | 关闭指定 targetId 的页面               |
| `/navigate`   | GET  | `target`, `url`                        | 导航至 URL                             |
| `/back`       | GET  | `target`                               | 浏览器后退                             |
| `/info`       | GET  | `target`                               | 返回 title、url、readyState            |
| `/eval`       | POST | `target`, body=JS 代码                 | 执行 JavaScript                        |
| `/click`      | POST | `target`, body=选择器                  | `document.querySelector().click()`     |
| `/clickAt`    | POST | `target`, body=选择器                  | 真实鼠标坐标点击，可触发文件对话框     |
| `/setFiles`   | POST | `target`, body=`{selector, files[]}`   | 文件上传                               |
| `/scroll`     | GET  | `target`, `y`, `direction`             | 滚动，direction: `up/down/top/bottom`  |
| `/screenshot` | GET  | `target`, `file`, `format`, `fullPage` | 截图，指定 file 则写磁盘否则返回二进制 |

## CONVENTIONS

- **Target 标识**: 所有操作页面的端点都需要 `target` 查询参数（targetId）
- **GET/POST 混用**: 读操作和导航用 GET + query params，写入操作（eval/click/setFiles）用 POST + raw body
- **Body 解析**: POST 端点直接读 raw text body，不做 JSON 解析（`/setFiles` 除外，需 JSON）
- **错误处理**: 统一返回 `{error: string}`，HTTP 状态码 400/500
- **无路由框架**: 原生 `http.createServer` + 手动 `pathname` 匹配，未使用 Express/Koa
