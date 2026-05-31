#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import json
import argparse
import sys

def split_jsonl(input_file, output_dir, indent=2):
    """
    将 JSONL 文件中的每一行解析为 JSON，并单独保存为一个 JSON 文件。
    """
    # 确保输入文件存在
    if not os.path.isfile(input_file):
        print(f"错误: 输入文件不存在: {input_file}", file=sys.stderr)
        return False

    # 确定输出目录
    if not output_dir:
        # 默认在输入文件所在目录下创建一个与其同名的文件夹（去掉后缀）
        base_name = os.path.splitext(os.path.basename(input_file))[0]
        output_dir = os.path.join(os.path.dirname(input_file), base_name)

    # 创建输出目录
    os.makedirs(output_dir, exist_ok=True)
    print(f"输入文件: {input_file}")
    print(f"输出目录: {output_dir}\n")

    success_count = 0
    fail_count = 0

    with open(input_file, 'r', encoding='utf-8') as f:
        for idx, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                # 跳过空行
                continue

            try:
                # 解析 JSON 以验证其格式并获取属性
                data = json.loads(line)
                
                # 尝试根据内容智能命名
                # 针对 tool 结果，尝试寻找 toolName 和 traceId
                tool_name = data.get('toolName')
                trace_id = data.get('traceId')
                
                if tool_name and trace_id:
                    # 过滤掉文件名中可能存在的不合法字符
                    clean_tool_name = "".join([c for c in str(tool_name) if c.isalpha() or c in '_-'])
                    clean_trace_id = "".join([c for c in str(trace_id) if c.isalnum() or c in '_-'])
                    file_name = f"{idx:03d}_{clean_tool_name}_{clean_trace_id}.json"
                else:
                    file_name = f"{idx:03d}_record.json"

                output_path = os.path.join(output_dir, file_name)
                
                # 保存为单独的格式化后的 JSON 文件
                with open(output_path, 'w', encoding='utf-8') as out_f:
                    json.dump(data, out_f, ensure_ascii=False, indent=indent)
                
                print(f"已保存: {file_name}")
                success_count += 1

            except json.JSONDecodeError as e:
                print(f"第 {idx} 行解析 JSON 失败: {e}. 跳过该行。", file=sys.stderr)
                fail_count += 1
            except Exception as e:
                print(f"第 {idx} 行保存失败: {e}. 跳过该行。", file=sys.stderr)
                fail_count += 1

    print(f"\n处理完成! 成功保存: {success_count} 个文件, 失败/跳过: {fail_count} 个。")
    return True

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="将 JSONL 文件中的每一行单独导出为美化的 JSON 文件。")
    parser.add_argument(
        "-i", "--input", 
        default=r"artifacts/tool-results/2026-05-29.jsonl",
        help="输入的 JSONL 文件路径 (默认: artifacts/tool-results/2026-05-29.jsonl)"
    )
    parser.add_argument(
        "-o", "--output", 
        default=None,
        help="输出的文件夹路径 (默认: 在输入文件同级目录下生成同名文件夹)"
    )
    parser.add_argument(
        "--indent", 
        type=int, 
        default=2, 
        help="JSON 缩进空格数 (默认: 2)"
    )

    args = parser.parse_args()
    
    # 转换为绝对路径
    input_path = os.path.abspath(args.input)
    output_path = os.path.abspath(args.output) if args.output else None

    split_jsonl(input_path, output_path, args.indent)
