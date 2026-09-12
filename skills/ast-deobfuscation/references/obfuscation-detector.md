# 通用混淆器与保护特征检测器

## 目标与作用

在执行针对性 AST 反混淆流水线之前，准确检测目标脚本中存在的多种复合混淆技术与加固家族，输出多标签特征集合，指导流水线编排工具选择针对性的 pass 或跳过无关 pass。

## 检测特征矩阵

1. **混淆工具家族**：
   - `javascript-obfuscator`：`_0x` 标识符、大数组定义与自执行位移函数。
   - `jsfuck`：代码仅由 `[]()+!` 六种字符组成。
   - `packer`：Dean Edwards 的 `eval(function(p,a,c,k,e,r)...)`。
   - `aaencode`：包含表情符号字符集 `(ﾟДﾟ) ['_']`、`o゜)` 等。
   - `urlencoded`：高密度 `%xx` URI 转义字符。
2. **混淆技术手段**：
   - `invisible-unicode`：零宽空格及隐藏 Unicode 编码。
   - `control-flow-flattening`：`while` 循环嵌套 `switch` 状态机。
   - `opaque-predicates`：恒真/恒假条件与数学/位运算不透明谓词。
   - `string-array-rotation`：大数组 IIFE 自执行洗牌函数（push/shift 循环）。
   - `hex-encoding`：大密度 `\x..` 十六进制字符串字面量。
   - `base64-encoding`：静态内联 base64 字符串结合 `atob`/自定义解码器。
   - `vm-protection`：包含字节码数组、程序计数器（pc）、栈操作（push/pop）及虚拟机分发解释循环。
   - `webpack`：包含 `__webpack_require__` 或 `webpackJsonp` 打包结构。
3. **站点/商业防护产品**：
   - `reese84`, `dingxiang`, `geetest4`, `tonghuashun`, `yidun`, `xiaohongshu`, `ob-variant`。

## 脚本入口

- `scripts/detect-obfuscator-types.js <input.js> [output.json]`
- 支持 CLI 命令与模块导出：

  ```javascript
  const {detectObfuscationTypes} = require('./detect-obfuscator-types');
  const types = detectObfuscationTypes(code);
  ```
