#!/bin/bash
# JSReverser-MCP 自动测试循环脚本 v2
# 用法：./scripts/test-loop.sh

set -e

OUTPUT_FILE="/tmp/jsreverser-test-output.txt"

echo ""
echo "┌─────────────────────────────────────────┐"
echo "│  🚀 JSReverser-MCP 自动测试循环         │"
echo "└─────────────────────────────────────────┘"
echo ""
echo "开始时间：$(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# Step 1: Build
echo "=== Step 1: 构建验证 ==="
BUILD_OUTPUT=$(npm run build 2>&1)
BUILD_STATUS=$?

echo "$BUILD_OUTPUT" | tail -3

if [ $BUILD_STATUS -ne 0 ]; then
    echo ""
    echo "❌ 构建失败"
    exit 1
fi

echo "✅ 构建成功"
echo ""

# Step 2: Test
echo "=== Step 2: 运行测试 ==="
npm run test:quick > "$OUTPUT_FILE" 2>&1
TEST_STATUS=$?

# 分析结果
PASS_COUNT=$(grep -c "✔" "$OUTPUT_FILE" 2>/dev/null || echo "0")
FAIL_COUNT=$(grep "✖" "$OUTPUT_FILE" 2>/dev/null | wc -l)
SKIP_COUNT=$(grep "# SKIP" "$OUTPUT_FILE" 2>/dev/null | wc -l)

# 检测新错误
NEW_ERRORS=0
if [ -f /tmp/jsreverser-last-errors.txt ]; then
    NEW_ERRORS=$(diff <(sort /tmp/jsreverser-last-errors.txt) <(grep "✖" "$OUTPUT_FILE" 2>/dev/null | sort) 2>/dev/null | grep "^>" | wc -l || echo "0")
fi
grep "✖" "$OUTPUT_FILE" 2>/dev/null > /tmp/jsreverser-last-errors.txt || true

echo ""
echo "┌─────────────────────────────────────────┐"
echo "│  📊 测试结果汇总                        │"
echo "└─────────────────────────────────────────┘"
echo ""
echo "  通过：    $PASS_COUNT"
echo "  失败：    $FAIL_COUNT"
echo "  跳过：    $SKIP_COUNT"
echo "  新错误：  $NEW_ERRORS"
echo ""

if [ $TEST_STATUS -eq 0 ] && [ "$FAIL_COUNT" -eq 0 ]; then
    echo "┌─────────────────────────────────────────┐"
    echo "│  ✅ 测试全部通过                        │"
    echo "└─────────────────────────────────────────┘"
else
    echo "┌─────────────────────────────────────────┐"
    echo "│  ❌ 测试失败                            │"
    echo "└─────────────────────────────────────────┘"
    echo ""
    echo "失败详情:"
    grep "✖" "$OUTPUT_FILE" 2>/dev/null | head -10
fi

echo ""
echo "完成时间：$(date '+%Y-%m-%d %H:%M:%S')"
echo "└─────────────────────────────────────────┘"

exit $TEST_STATUS
