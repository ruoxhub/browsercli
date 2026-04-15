/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {z} from 'zod';

import {siteExperienceService} from '../services/SiteExperienceService.js';

import {ToolCategory} from './categories.js';
import {defineTool} from './ToolDefinition.js';
import type {Context} from './ToolDefinition.js';

/**
 * 搜索站点经验
 */
export const searchSiteExperience = defineTool({
  name: 'search_site_experience',
  description:
    '按 URL 或名称搜索站点经验。支持从完整 URL 自动提取域名进行匹配。',
  annotations: {
    category: ToolCategory.DATA,
    readOnlyHint: true,
    title: 'Search site experience',
  },
  schema: {
    url: z.string().optional().describe('要搜索的 URL 或域名'),
    name: z.string().optional().describe('要搜索的站点名称'),
  },
  async handler(request, response, _context: Context) {
    const {url, name} = request.params;

    if (!url && !name) {
      response.appendResponseLine('请提供 url 或 name 参数进行搜索');
      return;
    }

    try {
      const results = await siteExperienceService.search({url, name});

      if (results.length === 0) {
        response.appendResponseLine('未找到匹配的站点经验');
        return;
      }

      response.appendResponseLine(`找到 ${results.length} 条站点经验:\n`);

      for (const exp of results) {
        response.appendResponseLine('---');
        response.appendResponseLine(`**ID**: ${exp.id}`);
        response.appendResponseLine(`**域名**: ${exp.domain}`);
        response.appendResponseLine(`**名称**: ${exp.name}`);
        if (exp.aliases && exp.aliases.length > 0) {
          response.appendResponseLine(`**别名**: ${exp.aliases.join(', ')}`);
        }
        if (exp.platformFeatures) {
          response.appendResponseLine(`**平台特征**:\n${exp.platformFeatures}`);
        }
        if (exp.validPatterns) {
          response.appendResponseLine(`**有效模式**:\n${exp.validPatterns}`);
        }
        if (exp.knownPitfalls) {
          response.appendResponseLine(`**已知陷阱**:\n${exp.knownPitfalls}`);
        }
        response.appendResponseLine(
          `**更新时间**: ${exp.updatedAt?.toISOString() || 'N/A'}`,
        );
      }
    } catch (error) {
      response.appendResponseLine(
        `搜索失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});

/**
 * 创建站点经验
 */
export const createSiteExperience = defineTool({
  name: 'create_site_experience',
  description: '创建新的站点经验记录',
  annotations: {
    category: ToolCategory.DATA,
    readOnlyHint: false,
    title: 'Create site experience',
  },
  schema: {
    domain: z.string().describe('站点域名（例如：example.com）'),
    name: z.string().describe('站点名称'),
    aliases: z.array(z.string()).optional().describe('站点别名列表'),
    platformFeatures: z.string().optional().describe('平台特征描述'),
    validPatterns: z.string().optional().describe('有效模式描述'),
    knownPitfalls: z.string().optional().describe('已知陷阱描述'),
  },
  async handler(request, response, _context: Context) {
    const {
      domain,
      name,
      aliases,
      platformFeatures,
      validPatterns,
      knownPitfalls,
    } = request.params;

    try {
      // 检查是否已存在相同域名
      const existing = await siteExperienceService.getByDomain(domain);
      if (existing) {
        response.appendResponseLine(
          `域名 ${domain} 已存在（ID: ${existing.id}），请使用 update_site_experience 更新`,
        );
        return;
      }

      const result = await siteExperienceService.create({
        domain,
        name,
        aliases: aliases || [],
        platformFeatures: platformFeatures || null,
        validPatterns: validPatterns || null,
        knownPitfalls: knownPitfalls || null,
      });

      response.appendResponseLine('成功创建站点经验:');
      response.appendResponseLine(`**ID**: ${result.id}`);
      response.appendResponseLine(`**域名**: ${result.domain}`);
      response.appendResponseLine(`**名称**: ${result.name}`);
      response.appendResponseLine(
        `**创建时间**: ${result.createdAt?.toISOString() || 'N/A'}`,
      );
    } catch (error) {
      response.appendResponseLine(
        `创建失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});

/**
 * 更新站点经验
 */
export const updateSiteExperience = defineTool({
  name: 'update_site_experience',
  description: '更新现有的站点经验记录',
  annotations: {
    category: ToolCategory.DATA,
    readOnlyHint: false,
    title: 'Update site experience',
  },
  schema: {
    id: z.number().describe('要更新的站点经验 ID'),
    name: z.string().optional().describe('新的站点名称'),
    aliases: z.array(z.string()).optional().describe('新的别名列表'),
    platformFeatures: z.string().optional().describe('新的平台特征描述'),
    validPatterns: z.string().optional().describe('新的有效模式描述'),
    knownPitfalls: z.string().optional().describe('新的已知陷阱描述'),
  },
  async handler(request, response, _context: Context) {
    const {id, name, aliases, platformFeatures, validPatterns, knownPitfalls} =
      request.params;

    try {
      const updateData: Record<string, unknown> = {
        ...(name !== undefined && {name}),
        ...(aliases !== undefined && {aliases}),
        ...(platformFeatures !== undefined && {platformFeatures}),
        ...(validPatterns !== undefined && {validPatterns}),
        ...(knownPitfalls !== undefined && {knownPitfalls}),
      };

      const result = await siteExperienceService.update(id, updateData);

      if (!result) {
        response.appendResponseLine(`未找到 ID 为 ${id} 的站点经验`);
        return;
      }

      response.appendResponseLine('成功更新站点经验:');
      response.appendResponseLine(`**ID**: ${result.id}`);
      response.appendResponseLine(`**域名**: ${result.domain}`);
      response.appendResponseLine(`**名称**: ${result.name}`);
      response.appendResponseLine(
        `**更新时间**: ${result.updatedAt?.toISOString() || 'N/A'}`,
      );
    } catch (error) {
      response.appendResponseLine(
        `更新失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});

/**
 * 删除站点经验
 */
export const deleteSiteExperience = defineTool({
  name: 'delete_site_experience',
  description: '删除站点经验记录',
  annotations: {
    category: ToolCategory.DATA,
    readOnlyHint: false,
    title: 'Delete site experience',
  },
  schema: {
    id: z.number().describe('要删除的站点经验 ID'),
  },
  async handler(request, response, _context: Context) {
    const {id} = request.params;

    try {
      const deleted = await siteExperienceService.delete(id);

      if (!deleted) {
        response.appendResponseLine(`未找到 ID 为 ${id} 的站点经验`);
        return;
      }

      response.appendResponseLine(`成功删除站点经验 (ID: ${id})`);
    } catch (error) {
      response.appendResponseLine(
        `删除失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});

/**
 * 列出所有站点经验
 */
export const listSiteExperiences = defineTool({
  name: 'list_site_experiences',
  description: '列出所有已保存的站点经验',
  annotations: {
    category: ToolCategory.DATA,
    readOnlyHint: true,
    title: 'List site experiences',
  },
  schema: {},
  async handler(request, response, _context: Context) {
    try {
      const results = await siteExperienceService.listAll();

      if (results.length === 0) {
        response.appendResponseLine('暂无站点经验记录');
        return;
      }

      response.appendResponseLine(`共 ${results.length} 条站点经验:\n`);

      for (const exp of results) {
        response.appendResponseLine(
          `- **${exp.name}** (${exp.domain}) [ID: ${exp.id}]`,
        );
      }

      response.appendResponseLine(
        '\n使用 `search_site_experience` 查看详细信息，或使用 `id` 进行更新/删除操作',
      );
    } catch (error) {
      response.appendResponseLine(
        `获取列表失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
