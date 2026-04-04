#!/bin/bash
# JSReverser-MCP 测试结果 Dashboard
# 用法：./scripts/test-dashboard.sh [--run] [--watch]

set -e

RESULT_FILE="/tmp/jsreverser-test-result.json"
OUTPUT_FILE="/tmp/jsreverser-test-output.txt"

# 解析参数
RUN_TEST=false
WATCH_MODE=false

for arg in "$@"; do
    case $arg in
        --run)
            RUN_TEST=true
            ;;
        --watch)
            WATCH_MODE=true
            ;;
    esac
done

# 如果需要运行测试
if [ "$RUN_TEST" = true ]; then
    echo "========================================"
    echo "  JSReverser-MCP 自动测试循环"
    echo "========================================"
    echo "开始时间：$(date '+%Y-%m-%d %H:%M:%S')"
    echo ""

    # Build
    echo "=== Step 1: 构建验证 ==="
    BUILD_OUTPUT=$(npm run build 2>&1)
    BUILD_STATUS=$?
    echo "$BUILD_OUTPUT" | tail -3

    if [ $BUILD_STATUS -ne 0 ]; then
        echo '{"status":"failed","phase":"build","timestamp":"'$(date -Iseconds)'"}' > "$RESULT_FILE"
        exit 1
    fi

    echo "✅ 构建成功"
    echo ""

    # Test
    echo "=== Step 2: 运行测试 ==="
    npm run test:quick > "$OUTPUT_FILE" 2>&1
    TEST_STATUS=$?

    # 分析结果
    PASS_COUNT=$(grep -c "✔" "$OUTPUT_FILE" 2>/dev/null || echo "0")
    FAIL_COUNT=$(grep "✖" "$OUTPUT_FILE" 2>/dev/null | wc -l || echo "0")
    SKIP_COUNT=$(grep "# SKIP" "$OUTPUT_FILE" 2>/dev/null | wc -l || echo "0")

    # 生成 JSON 结果
    cat > "$RESULT_FILE" << EOF
{
  "status": "$([ $TEST_STATUS -eq 0 ] && echo 'passed' || echo 'failed')",
  "timestamp": "$(date -Iseconds)",
  "build": {
    "status": "passed",
    "files": 248
  },
  "test": {
    "passed": $PASS_COUNT,
    "failed": $FAIL_COUNT,
    "skipped": $SKIP_COUNT,
    "duration_seconds": $((SECONDS / 60))
  }
}
EOF

    echo ""
    echo "========================================"
    echo "  测试结果汇总"
    echo "========================================"
    echo "通过：$PASS_COUNT"
    echo "失败：$FAIL_COUNT"
    echo "跳过：$SKIP_COUNT"
    echo ""

    if [ $TEST_STATUS -eq 0 ]; then
        echo "✅ 测试全部通过"
    else
        echo "❌ 测试失败"
    fi

    echo ""
    echo "完成时间：$(date '+%Y-%m-%d %H:%M:%S')"
    echo "========================================"
    echo ""
    echo "📊 结果已保存到：$RESULT_FILE"
    echo "📄 完整输出：$OUTPUT_FILE"

    exit $TEST_STATUS
fi

# 显示最新结果
echo ""
echo "┌─────────────────────────────────────────┐"
echo "│  📊 JSReverser-MCP 测试 Dashboard      │"
echo "└─────────────────────────────────────────┘"
echo ""

if [ -f "$RESULT_FILE" ]; then
    LAST_UPDATE=$(cat "$RESULT_FILE" | grep -o '"timestamp"[^,]*' | cut -d'"' -f4)
    STATUS=$(cat "$RESULT_FILE" | grep -o '"status"[^,]*' | cut -d'"' -f4)
    PASSED=$(cat "$RESULT_FILE" | grep -o '"passed":[^,}]*' | head -1 | cut -d':' -f2 | tr -d ' ')
    FAILED=$(cat "$RESULT_FILE" | grep -o '"failed":[^,}]*' | head -1 | cut -d':' -f2 | tr -d ' ')
    SKIPPED=$(cat "$RESULT_FILE" | grep -o '"skipped":[^,}]*' | cut -d':' -f2 | tr -d ' ')

    echo "最后更新：$LAST_UPDATE"
    echo "状态：$([ "$STATUS" = "passed" ] && echo "✅ 通过" || echo "❌ 失败")"
    echo ""
    echo "┌──────────────────────────────────────┐"
    echo "│  通过：$PASSED                          │"
    echo "│  失败：$FAILED                           │"
    echo "│  跳过：$SKIPPED                          │"
    echo "└──────────────────────────────────────┘"
    echo ""
    echo "运行新测试：./scripts/test-dashboard.sh --run"
    echo "查看完整输出：cat $OUTPUT_FILE"
else
    echo "⚠️  暂无测试结果"
    echo ""
    echo "运行测试：./scripts/test-dashboard.sh --run"
fi
