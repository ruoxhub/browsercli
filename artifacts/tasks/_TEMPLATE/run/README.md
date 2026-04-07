# run/

Put executable local scripts here.
Do not move these scripts into repository case files.

## 目录约束

- 必须有一个当前主入口，并在这里明确写出
- 推荐把主线、校验、取证、证据、归档分开
- 不要让多个等价顶层入口长期并存
- 不要把 `.venv/`、`__pycache__/`、临时缓存当成任务产物

## 推荐结构

- `core/`: 当前主线 runtime / portable runtime / pure runtime
- `verify/`: 接口闭环校验
- `trace/`: 逆向取证、hook、插桩、提纯辅助
- `server/`: 面向部署或真实调用的最小入口
- `evidence/`: 基线、夹具、摘要、差异记录
- `legacy/`: 已归档旧入口
- `vendor/`: 原始脚本副本

## 主入口要求

请在这里直接写明：

- 当前推荐入口文件
- 最常用 1 到 3 条命令
- 哪些目录已经归档，不再继续接新逻辑
