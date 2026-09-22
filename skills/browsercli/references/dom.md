# DOM 交互、拟人化操作与样式检查参考文档 (DOM & Interaction Reference)

DOM 元素查询、拟人化模拟点击/打字/拖拽、物理坐标点击、表单批量填充、页面截图与样式层叠分析工具。

## 概览 (Overview)

用于触发页面交互（点击按钮、键入密码、拖拽滑块）以驱动前端加密逻辑运行并生成网络请求。定位器原生支持 CSS、`role=`、`text=`、`xpath=`，多项匹配时支持 `>> nth=N` 消歧。

| 工具名称                    | 功能描述                                                                          | 核心参数                                                         |
| :-------------------------- | :-------------------------------------------------------------------------------- | :--------------------------------------------------------------- |
| `query_dom`                 | 通过定位器查询 DOM 元素属性、标签名、包围盒与可见性                               | `--selector <str>`, `[--all <bool>]`, `[--limit <num>]`          |
| `get_dom_structure`         | 获取当前页面的精简 DOM 树结构（层级、类名、文本）                                 | `[--maxDepth <num>]`, `[--includeText <bool>]`                   |
| `find_clickable_elements`   | 快速检索页面中所有可点击的按钮与链接                                              | `[--filterText <str>]`                                           |
| `click`                     | 模拟点击目标元素（支持单击、双击）                                                | `--selector <str>`, `[--dblClick <bool>]`, `[--timeoutMs <num>]` |
| `click_at`                  | 通过 CDP 物理绝对坐标点击元素中心（彻底绕过 Playwright 自动化特征及元素覆盖检测） | `--selector <str>`                                               |
| `fill` / `type_text`        | 填入值（支持 selectOption）或拟人化按键打字（支持延时）                           | `--selector <str>`, `--value/--text <str>`, `[--delay <num>]`    |
| `fill_form`                 | 一次调用批量填充多个表单输入项                                                    | `--elements <arr>`, `[--timeoutMs <num>]`                        |
| `press_key`                 | 触发物理键盘按键或组合快捷键（如 "Enter"、"Control+A"）                           | `--key <str>`                                                    |
| `hover` / `drag`            | 鼠标悬停 / 元素间拖拽操作（滑块验证必备）                                         | `--selector <str>`, `--fromSelector / --toSelector`              |
| `upload_file` / `set_files` | 文件上传操作（Playwright 模式或 CDP 底层模式）                                    | `--selector <str>`, `--filePath / --filePaths`                   |
| `scroll_by`                 | 按方向滚动页面并自动延时触发懒加载资源                                            | `--direction <str>`, `[--pixels <num>]`                          |
| `wait_for_element`          | 等待指定定位器的元素渲染出现                                                      | `--selector <str>`, `[--timeout <num>]`                          |
| `handle_dialog`             | 自动接管 alert/confirm/prompt 弹窗（确定或取消）                                  | `--action <str>`, `[--promptText <str>]`                         |
| `take_screenshot`           | 对全页面或指定元素进行截图截屏                                                    | `[--fullPage <bool>]`, `[--filePath <str>]`                      |
| `get_css_styles`            | 获取元素匹配的 CSS 规则、内联样式与层叠状态（排查反爬隐藏样式/覆盖冲突）          | `--selector <str>`, `[--pageSize <num>]`                         |
| `reveal_in_devtools`        | 在页面上高亮显示目标 DOM 元素数秒，便于直观定位                                   | `--selector <str>`, `[--durationMs <num>]`                       |

---

## 详细命令与示例

### 1. 元素检索与排查

```bash
# 查询登录按钮状态与坐标
browsercli call query_dom --selector "button[type='submit']"

# 查找所有包含“登录”或“下一步”的按钮
browsercli call find_clickable_elements --filterText "登录"

# 排查元素隐藏样式（查看 display/visibility 是否被反爬样式覆盖）
browsercli call get_css_styles --selector "#verify-code"
```

### 2. 拟人化点击与输入模拟

```bash
# 普通模拟点击
browsercli call click --selector "button#submit"

# CDP 真实物理坐标点击（滑块、反自动化按钮推荐）
browsercli call click_at --selector "div.geetest_slider_btn"

# 拟人化打字输入（每个字符间隔 80ms，触发 input/keydown 事件）
browsercli call type_text --selector "input#password" --text "mypassword123" --delay 80

# 批量填充表单
browsercli call fill_form --elements '[
  {"selector": "input#username", "value": "admin"},
  {"selector": "input#password", "value": "123456"}
]'
```

### 3. 滑块拖拽与滚动加载

```bash
# 拖拽滑块通过验证
browsercli call drag --fromSelector "div.slider-btn" --toSelector "div.slider-target"

# 向下滚动 800 像素以触发懒加载流
browsercli call scroll_by --direction down --pixels 800
```

### 4. 截图与节点高亮

```bash
# 截取整页为图片保存
browsercli call take_screenshot --fullPage true --filePath "artifacts/page.png"

# 高亮页面元素 3 秒协助肉眼核实
browsercli call reveal_in_devtools --selector "form.login-box" --durationMs 3000
```
