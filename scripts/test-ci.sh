#!/bin/bash
# JSReverser-MCP 一键测试闭环脚本
# 用法：./scripts/test-ci.sh

set -e

LOG_FILE="/tmp/jsreverser-ci.log"
RESULT_FILE="/tmp/jsreverser-ci-result.json"

echo ""
echo "╔═══════════════════════════════════════╗"
echo "║  🚀 JSReverser-MCP CI 测试闭环        ║"
echo "╚═══════════════════════════════════════╝"
echo ""
echo "启动时间：$(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# Step 1: Build
echo "📦 Step 1/2: 构建验证"
echo "───────────────────────────────────────"
if npm run build > "$LOG_FILE" 2>&1; then
    BUILD_TIME=$(grep "swc" "$LOG_FILE" | grep -oP '\d+\.\d+(?=ms)' | head -1)
    echo "  ✅ 构建成功 (${BUILD_TIME}ms)"
else
    echo "  ❌ 构建失败"
    cat "$LOG_FILE" | tail -10
    echo '{"status":"failed","phase":"build"}' > "$RESULT_FILE"
    exit 1
fi
echo ""

# Step 2: Test
echo "🧪 Step 2/2: 运行测试"
echo "───────────────────────────────────────"
START_TIME=$(date +%s)
npm run test:quick >> "$LOG_FILE" 2>&1
TEST_STATUS=$?
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

# 分析结果
PASS_COUNT=$(grep -c "✔" "$LOG_FILE" 2>/dev/null || echo "0")
FAIL_COUNT=$(grep "✖" "$LOG_FILE" 2>/dev/null | wc -l)
SKIP_COUNT=$(grep "# SKIP" "$LOG_FILE" 2>/dev/null | wc -l)

echo "  通过：$PASS_COUNT"
echo "  失败：$FAIL_COUNT"
echo "  跳过：$SKIP_COUNT"
echo "  耗时：${DURATION}s"
echo ""

# 生成结果
echo "╔═══════════════════════════════════════╗"
if [ $TEST_STATUS -eq 0 ] && [ "$FAIL_COUNT" -eq 0 ]; then
    echo "║  ✅ TEST PASSED                      ║"
    STATUS="passed"
else
    echo "║  ❌ TEST FAILED                      ║"
    STATUS="failed"
    echo "╠═══════════════════════════════════════╣"
    echo "║  失败详情:"
    grep "✖" "$LOG_FILE" 2>/dev/null | head -5 | sed 's/^/║  /'
fi
echo "╚═══════════════════════════════════════╝"
echo ""
echo "完成时间：$(date '+%Y-%m-%d %H:%M:%S')"

# 生成 JSON 结果
cat > "$RESULT_FILE" << EOF
{
  "status": "$STATUS",
  "timestamp": "$(date -Iseconds)",
  "build": {"status": "passed", "duration_ms": $BUILD_TIME},
  "test": {
    "passed": $PASS_COUNT,
    "failed": $FAIL_COUNT,
    "skipped": $SKIP_COUNT,
    "duration_s": $DURATION
  }
}
EOF

exit $TEST_STATUS
