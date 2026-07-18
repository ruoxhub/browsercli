/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {siteExperienceService} from '../../services/SiteExperienceService.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

/**
 * 搜索站点经验。
 */
export const searchSiteExperience = defineTool({
  name: 'search_site_experience',
  description: '按 URL 或名称搜索站点经验',
  annotations: {category: ToolCategory.DATA, readOnlyHint: true},
  schema: {
    url: zod.string().optional().describe('要搜索的站点 URL'),
    name: zod.string().optional().describe('要搜索的站点名称'),
  },
  handler: async (request, response) => {
    const {url, name} = request.params;

    if (!url && !name) {
      response.setStructuredContent({
        success: false,
        message: '请提供 url 或 name 参数进行搜索',
        tooltype: 'search_site_experience',
        data: {results: []},
      });
      return;
    }

    try {
      const searchParams: {url?: string; name?: string} = {};
      if (url !== undefined) searchParams.url = url;
      if (name !== undefined) searchParams.name = name;
      const results = await siteExperienceService.search(searchParams);
      response.setStructuredContent({
        success: true,
        message: `找到 ${results.length} 条站点经验`,
        tooltype: 'search_site_experience',
        data: {results},
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `搜索失败：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'search_site_experience',
        data: {results: []},
      });
    }
  },
});

/**
 * 创建站点经验。
 */
export const createSiteExperience = defineTool({
  name: 'create_site_experience',
  description: '创建新的站点经验条目',
  annotations: {category: ToolCategory.DATA, readOnlyHint: false},
  schema: {
    domain: zod.string().describe('站点域名（必填）'),
    name: zod.string().describe('站点名称（必填）'),
    aliases: zod.array(zod.string()).optional().describe('域名别名'),
    platformFeatures: zod
      .string()
      .optional()
      .describe('平台特性描述'),
    validPatterns: zod
      .string()
      .optional()
      .describe('有效模式描述'),
    knownPitfalls: zod
      .string()
      .optional()
      .describe('已知坑点描述'),
  },
  handler: async (request, response) => {
    const params = request.params;

    if (
      !params.domain ||
      typeof params.domain !== 'string' ||
      !params.domain.trim()
    ) {
      response.setStructuredContent({
        success: false,
        message: '创建失败：domain 为必填字段，且不能为空字符串',
        tooltype: 'create_site_experience',
      });
      return;
    }
    if (
      !params.name ||
      typeof params.name !== 'string' ||
      !params.name.trim()
    ) {
      response.setStructuredContent({
        success: false,
        message: '创建失败：name 为必填字段，且不能为空字符串',
        tooltype: 'create_site_experience',
      });
      return;
    }

    try {
      const existing = await siteExperienceService.getByDomain(
        params.domain.trim(),
      );
      if (existing) {
        response.setStructuredContent({
          success: false,
          message: `域名 ${params.domain.trim()} 已存在（ID: ${existing.id}），请使用 update 更新`,
          tooltype: 'create_site_experience',
          data: existing,
        });
        return;
      }

      const aliases = Array.isArray(params.aliases) ? params.aliases : [];

      const result = await siteExperienceService.create({
        domain: params.domain.trim(),
        name: params.name.trim(),
        aliases,
        platformFeatures: params.platformFeatures ?? null,
        validPatterns: params.validPatterns ?? null,
        knownPitfalls: params.knownPitfalls ?? null,
      });

      response.setStructuredContent({
        success: true,
        message: `成功创建站点经验 (ID: ${result.id})`,
        tooltype: 'create_site_experience',
        data: result,
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `创建失败：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'create_site_experience',
      });
    }
  },
});

/**
 * 更新站点经验。
 */
export const updateSiteExperience = defineTool({
  name: 'update_site_experience',
  description: '更新已有的站点经验条目',
  annotations: {category: ToolCategory.DATA, readOnlyHint: false},
  schema: {
    id: zod.number().describe('要更新的站点经验 ID'),
    name: zod.string().optional().describe('更新后的站点名称'),
    aliases: zod
      .array(zod.string())
      .optional()
      .describe('更新后的域名别名'),
    platformFeatures: zod
      .string()
      .optional()
      .describe('更新后的平台特性'),
    validPatterns: zod.string().optional().describe('更新后的有效模式'),
    knownPitfalls: zod.string().optional().describe('更新后的已知坑点'),
  },
  handler: async (request, response) => {
    const params = request.params;

    try {
      const updateData: Record<string, unknown> = {
        ...(params.name !== undefined && {name: params.name}),
        ...(params.aliases !== undefined && {aliases: params.aliases}),
        ...(params.platformFeatures !== undefined && {
          platformFeatures: params.platformFeatures,
        }),
        ...(params.validPatterns !== undefined && {
          validPatterns: params.validPatterns,
        }),
        ...(params.knownPitfalls !== undefined && {
          knownPitfalls: params.knownPitfalls,
        }),
      };

      const result = await siteExperienceService.update(params.id, updateData);

      if (!result) {
        response.setStructuredContent({
          success: false,
          message: `未找到 ID 为 ${params.id} 的站点经验`,
          tooltype: 'update_site_experience',
        });
        return;
      }

      response.setStructuredContent({
        success: true,
        message: `成功更新站点经验 (ID: ${result.id})`,
        tooltype: 'update_site_experience',
        data: result,
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `更新失败：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'update_site_experience',
      });
    }
  },
});

/**
 * 删除站点经验。
 */
export const deleteSiteExperience = defineTool({
  name: 'delete_site_experience',
  description: '按 ID 删除站点经验条目',
  annotations: {category: ToolCategory.DATA, readOnlyHint: false},
  schema: {
    id: zod.number().describe('要删除的站点经验 ID'),
  },
  handler: async (request, response) => {
    const {id} = request.params;

    try {
      const deleted = await siteExperienceService.delete(id);

      if (!deleted) {
        response.setStructuredContent({
          success: false,
          message: `未找到 ID 为 ${id} 的站点经验`,
          tooltype: 'delete_site_experience',
        });
        return;
      }

      response.setStructuredContent({
        success: true,
        message: `成功删除站点经验 (ID: ${id})`,
        tooltype: 'delete_site_experience',
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `删除失败：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'delete_site_experience',
      });
    }
  },
});

/**
 * 列出所有站点经验。
 */
export const listSiteExperiences = defineTool({
  name: 'list_site_experiences',
  description: '列出所有站点经验条目',
  annotations: {category: ToolCategory.DATA, readOnlyHint: true},
  schema: {},
  handler: async (_request, response) => {
    try {
      const results = await siteExperienceService.listAll();
      response.setStructuredContent({
        success: true,
        message: `共 ${results.length} 条站点经验`,
        tooltype: 'list_site_experiences',
        data: {results},
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `获取列表失败：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'list_site_experiences',
        data: {results: []},
      });
    }
  },
});
