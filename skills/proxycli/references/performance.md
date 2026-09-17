# 页面性能监控与追踪参考文档 (Performance Reference)

Core Web Vitals (CWV) 评估、CDP 性能追踪录制与耗时诊断工具。

## 概览 (Overview)

用于分析前端渲染性能、重绘卡顿、关键请求瀑布流及性能瓶颈 Insight。

| 工具名称                      | 功能描述                                                         | 核心参数                               |
| :---------------------------- | :--------------------------------------------------------------- | :------------------------------------- |
| `start_performance_trace`     | 在当前页面启动 CDP Performance 轨迹录制，计算 CWV 评分           | `--reload <bool>`, `--autoStop <bool>` |
| `stop_performance_trace`      | 停止性能追踪录制并完成数据分析                                   | 无                                     |
| `get_performance_metrics`     | 获取页面性能时序（Navigation Timing、Resource Timing、绘制事件） | 无                                     |
| `performance_analyze_insight` | 深度分析追踪录制中高亮的特定性能 Insight 详情                    | `--insightName <str>`                  |

---

## 详细命令与示例

### 1. 录制页面加载性能轨迹

```bash
# 开启性能追踪并自动重载页面
proxycli call start_performance_trace --reload true --autoStop true

# 手动停止追踪录制
proxycli call stop_performance_trace
```

### 2. 获取性能指标与 Insight 分析

```bash
# 获取导航与资源时序指标
proxycli call get_performance_metrics

# 深入分析具体的性能 Insight（如 LCP、CLS 等）
proxycli call performance_analyze_insight --insightName "LCPBreakdown"
```
