/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';
import {AxiError} from 'axi-sdk-js';

import type {VideoRecording} from '../../modules/video/types.js';
import {getBoolFlag, getFlag, parseArgs} from '../args-parser.js';
import {successOutput, tableOutput} from '../output.js';
import type {WorkerContext} from '../types.js';

import {invokeWithBusyRetry} from './tool-dispatcher.js';

interface VideoToolResponse {
  recording?: VideoRecording;
  recordings?: Array<{recording?: VideoRecording; capability?: string}>;
  filePath?: string;
  discarded?: boolean;
  format?: string;
  audio?: boolean;
  max_duration_ms?: number;
  version?: number;
  error?: {message?: string; code?: string};
  [key: string]: unknown;
}

interface ToolInvokeResponse {
  content?: Array<{type: string; text?: string}>;
  isError?: boolean;
  structuredContent?: VideoToolResponse;
}

async function callVideoTool(
  ctx: WorkerContext | undefined,
  params: Record<string, unknown>,
): Promise<VideoToolResponse> {
  if (!ctx?.connect) {
    throw new AxiError('Worker context not available', 'WORKER_NOT_AVAILABLE');
  }
  const client = await ctx.connect();
  try {
    const raw = (await invokeWithBusyRetry(
      client,
      'video',
      params,
    )) as ToolInvokeResponse;
    if (raw.structuredContent) {
      const err = raw.structuredContent.error;
      if (err) {
        throw new AxiError(
          err.message || 'Video tool error',
          err.code || 'VIDEO_ERROR',
        );
      }
      return raw.structuredContent;
    }
    const text = raw.content?.[0]?.text;
    if (text) {
      try {
        const parsed = JSON.parse(text) as VideoToolResponse;
        const err = parsed.error;
        if (err) {
          throw new AxiError(
            err.message || 'Video tool error',
            err.code || 'VIDEO_ERROR',
          );
        }
        return parsed;
      } catch (e) {
        if (e instanceof AxiError) throw e;
        return {text};
      }
    }
    return (raw as unknown as VideoToolResponse) ?? {};
  } finally {
    client.close();
  }
}

export const videoCommand: AxiCliCommand<WorkerContext> = async (
  rawArgs,
  ctx,
) => {
  const parsed = parseArgs(rawArgs);
  const json = getBoolFlag(parsed, 'json');
  const action = parsed.positionals[0]?.toLowerCase() || 'help';

  if (
    action === 'help' ||
    getBoolFlag(parsed, 'help') ||
    getBoolFlag(parsed, 'h')
  ) {
    return `用法: browsercli video <command> [options]

命令:
  start                     开始录制当前浏览器会话
  stop [recording_id]       停止录制并生成 MP4 文件
  status [recording_id]     查看录制状态
  save <id> <output>        将录制的 MP4 文件另存到指定路径
  list                      列出所有缓存的录制项
  discard <id>              删除指定的录制缓存
  capabilities              查看视频录制支持的能力和规格

选项:
  --tab <id>                指定录制的 Tab 序号（默认当前活动页）
  --quality <standard|clear>画质预设（默认 standard: 1280x720@15fps）
  --max-duration <ms>       最长录制时长毫秒（默认 60000）
  --overwrite               保存时如果目标文件存在则强制覆盖
  --json                    以 JSON 格式输出结果
`;
  }

  try {
    switch (action) {
      case 'start': {
        const tabFlag = getFlag(parsed, 'tab');
        const qualityFlag = getFlag(parsed, 'quality');
        const durationFlag = getFlag(parsed, 'max-duration');

        const params: Record<string, unknown> = {
          action: 'start',
        };
        if (tabFlag !== undefined) params.tab_id = Number(tabFlag);
        if (qualityFlag !== undefined) params.quality = String(qualityFlag);
        if (durationFlag !== undefined)
          params.max_duration_ms = Number(durationFlag);

        const res = await callVideoTool(ctx, params);
        if (json) return successOutput(res);

        const rec = res.recording;
        if (!rec) {
          throw new AxiError('启动录制未返回 recording 信息', 'VIDEO_ERROR');
        }
        return (
          `录制已启动!\n` +
          `  ID:       ${rec.recording_id}\n` +
          `  状态:     ${rec.state}\n` +
          `  画质:     ${rec.quality}\n` +
          `  最长时长: ${rec.max_duration_ms / 1000}s\n` +
          `  目标页面: ${rec.title || 'Tab ' + rec.tab_id}\n\n` +
          `运行 'browsercli video stop' 停止并保存。`
        );
      }

      case 'stop': {
        let recordingId =
          parsed.positionals[1] || (getFlag(parsed, 'id') as string);
        if (!recordingId) {
          // 自动寻找正在录制的项
          const listRes = await callVideoTool(ctx, {action: 'list'});
          const recordings = (listRes.recordings ?? []) as Array<{
            recording?: {recording_id: string; state?: string};
          }>;
          const active = recordings.find(
            r =>
              r.recording?.state === 'recording' ||
              r.recording?.state === 'starting',
          );
          if (!active?.recording) {
            throw new AxiError(
              '当前没有正在录制的会话，请提供 recording_id',
              'NO_ACTIVE_RECORDING',
            );
          }
          recordingId = active.recording.recording_id;
        }

        const res = await callVideoTool(ctx, {
          action: 'stop',
          recording_id: recordingId,
        });
        if (json) return successOutput(res);

        const rec = res.recording;
        if (!rec) {
          throw new AxiError('停止录制未返回 recording 信息', 'VIDEO_ERROR');
        }
        return (
          `录制已停止并完成编码!\n` +
          `  ID:       ${rec.recording_id}\n` +
          `  状态:     ${rec.state}\n` +
          `  停止原因: ${rec.stop_reason}\n` +
          `  时长:     ${(rec.duration_ms / 1000).toFixed(1)}s\n` +
          `  总帧数:   ${rec.frames} (丢帧: ${rec.dropped_frames})\n` +
          `  文件大小: ${(rec.byte_size / 1024).toFixed(1)} KB\n\n` +
          `使用 'browsercli video save ${rec.recording_id} <path.mp4>' 导出视频。`
        );
      }

      case 'status': {
        let recordingId =
          parsed.positionals[1] || (getFlag(parsed, 'id') as string);
        if (!recordingId) {
          const listRes = await callVideoTool(ctx, {action: 'list'});
          const items = listRes.recordings || [];
          if (items.length === 0 || !items[0]?.recording) {
            return json ? successOutput({recordings: []}) : '暂无录制记录。';
          }
          recordingId = items[0].recording.recording_id;
        }

        const res = await callVideoTool(ctx, {
          action: 'status',
          recording_id: recordingId,
        });
        if (json) return successOutput(res);

        const rec = res.recording;
        if (!rec) {
          return '未找到该录制记录。';
        }
        return (
          `录制详情:\n` +
          `  ID:       ${rec.recording_id}\n` +
          `  状态:     ${rec.state}\n` +
          `  画质:     ${rec.quality}\n` +
          `  时长:     ${(rec.duration_ms / 1000).toFixed(1)}s / ${(rec.max_duration_ms / 1000).toFixed(0)}s\n` +
          `  帧数:     ${rec.frames} (丢帧: ${rec.dropped_frames})\n` +
          `  文件大小: ${(rec.byte_size / 1024).toFixed(1)} KB\n` +
          `  页面:     ${rec.title}`
        );
      }

      case 'save': {
        const recordingId = parsed.positionals[1];
        const outPath = parsed.positionals[2];
        const overwrite = getBoolFlag(parsed, 'overwrite');

        if (!recordingId || !outPath) {
          throw new AxiError(
            '用法: browsercli video save <recording_id> <output_path> [--overwrite]',
            'INVALID_ARGS',
          );
        }

        const res = await callVideoTool(ctx, {
          action: 'save',
          recording_id: recordingId,
          output: outPath,
          overwrite,
        });

        if (json) return successOutput(res);
        return `视频已成功保存至: ${res.filePath}`;
      }

      case 'list': {
        const res = await callVideoTool(ctx, {action: 'list'});
        if (json) return successOutput(res);

        const list = (res.recordings ?? [])
          .map(item => item.recording)
          .filter(
            (rec): rec is VideoRecording => rec !== undefined,
          );
        if (list.length === 0) {
          return '暂无录制记录。';
        }

        return tableOutput(
          ['ID', '状态', '画质', '时长(s)', '大小(KB)', '标题'],
          list.map(r => [
            r.recording_id,
            r.state,
            r.quality,
            (r.duration_ms / 1000).toFixed(1),
            (r.byte_size / 1024).toFixed(1),
            r.title || '',
          ]),
        );
      }

      case 'discard': {
        const recordingId = parsed.positionals[1];
        if (!recordingId) {
          throw new AxiError(
            '用法: browsercli video discard <recording_id>',
            'INVALID_ARGS',
          );
        }
        const res = await callVideoTool(ctx, {
          action: 'discard',
          recording_id: recordingId,
        });
        if (json) return successOutput(res);
        return `录制 ${recordingId} 已删除。`;
      }

      case 'capabilities': {
        const res = await callVideoTool(ctx, {action: 'capabilities'});
        if (json) return successOutput(res);
        return (
          `录制引擎规格:\n` +
          `  格式:         ${res.format}\n` +
          `  音频支持:     ${res.audio ? '是' : '否'}\n` +
          `  最长时长:     ${Number(res.max_duration_ms ?? 0) / 1000}s\n` +
          `  协议版本:     v${res.version}`
        );
      }

      default:
        throw new AxiError(
          `未知视频子命令: '${action}'。运行 'browsercli video help' 查看帮助。`,
          'UNKNOWN_ACTION',
        );
    }
  } catch (err) {
    if (json) {
      throw err;
    }
    throw err;
  }
};
