# Webcrack 与 Webpack/Browserify 打包器拆包 (Bundle Unpacker)

## 概述

现代前端应用与反爬防御脚本往往被 Webpack、Browserify 或 Rollup 打包成单文件巨大 Bundle。在进行深入的逆向或算法提取前，若能将其按照原生模块边界（Module ID / Path）切分拆解，反混淆与逆向难度将呈指数级下降。

## 核心能力

1. **Bundle 自动探测与解构**：
   - 识别 Webpack 2+、Webpack 4/5 `__webpack_require__`、`webpackJsonp`、`webpackChunk` 引导结构。
   - 识别 Browserify `(function e(t,n,r){...})` 依赖字典结构。
2. **模块切分与落盘 (Save to Directory)**：
   - 将各个独立模块剥离，并按其真实逻辑路径或 `module_<id>.js` 存储到指定目录。
   - 识别主入口模块（`isEntry: true`）并建立索引清单。
3. **Unminify 与 Mangle 还原**：
   - 还原变量名作用域，展开压缩代码为清晰易读的语法树。
   - 支持 JSX / 模板字面量反编译。
4. **AST 原生备用解包 (AST Fallback)**：
   - 当上游环境或超大文件无法直接运行 Webcrack 时，脚本内置基于 Babel AST 的 Webpack 模块数组/对象直接提取器作为稳健兜底。

## 脚本入口

- `scripts/unpack-webcrack.js <input.js> <output-dir> [--save-modules]`
- 支持模块导出：

  ```javascript
  const {unpackWithWebcrack} = require('./unpack-webcrack');

  const result = await unpackWithWebcrack(code, {
    outputDir: './dist/unpacked',
    saveModules: true,
  });
  console.log(
    `Unpacked ${result.modulesCount} modules from ${result.bundleType}`,
  );
  ```
