/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {siteExperienceService} from '../../services/SiteExperienceService.js';
import {zod} from '../../third_party/index.js';
import {defineTool} from '../ToolDefinition.js';
import {ToolCategory} from '../categories.js';

/**
 * 搜索站点经验。
 */
export const searchSiteExperience = defineTool({
  name: 'search_site_experience',
  description: 'Search site experience by URL or name',
  annotations: {category: ToolCategory.DATA, readOnlyHint: true},
  schema: {
    url: zod.string().optional().describe('Site URL to search'),
    name: zod.string().optional().describe('Site name to search'),
  },
  handler: async (request, response) => {
    const {url, name} = request.params;

    if (!url && !name) {
      response.appendResponseLine('```json');
      response.appendResponseLine(
        JSON.stringify(
          {
            success: false,
            message: '请提供 url 或 name 参数进行搜索',
            tooltype: 'search_site_experience',
            results: [],
          },
          null,
          2,
        ),
      );
      response.appendResponseLine('```');
      return;
    }

    try {
      const searchParams: {url?: string; name?: string} = {};
      if (url !== undefined) searchParams.url = url;
      if (name !== undefined) searchParams.name = name;
      const results = await siteExperienceService.search(searchParams);
      response.appendResponseLine('```json');
      response.appendResponseLine(
        JSON.stringify(
          {
            success: true,
            message: `找到 ${results.length} 条站点经验`,
            tooltype: 'search_site_experience',
            results,
          },
          null,
          2,
        ),
      );
      response.appendResponseLine('```');
    } catch (error) {
      response.appendResponseLine('```json');
      response.appendResponseLine(
        JSON.stringify(
          {
            success: false,
            message: `搜索失败：${error instanceof Error ? error.message : String(error)}`,
            tooltype: 'search_site_experience',
            results: [],
          },
          null,
          2,
        ),
      );
      response.appendResponseLine('```');
    }
  },
});

/**
 * 创建站点经验。
 */
export const createSiteExperience = defineTool({
  name: 'create_site_experience',
  description: 'Create a new site experience entry',
  annotations: {category: ToolCategory.DATA, readOnlyHint: false},
  schema: {
    domain: zod.string().describe('Site domain (required)'),
    name: zod.string().describe('Site name (required)'),
    aliases: zod.array(zod.string()).optional().describe('Domain aliases'),
    platformFeatures: zod
      .string()
      .optional()
      .describe('Platform features description'),
    validPatterns: zod
      .string()
      .optional()
      .describe('Valid patterns description'),
    knownPitfalls: zod
      .string()
      .optional()
      .describe('Known pitfalls description'),
  },
  handler: async (request, response) => {
    const params = request.params;

    if (
      !params.domain ||
      typeof params.domain !== 'string' ||
      !params.domain.trim()
    ) {
      response.appendResponseLine('```json');
      response.appendResponseLine(
        JSON.stringify(
          {
            success: false,
            message: '创建失败：domain 为必填字段，且不能为空字符串',
            tooltype: 'create_site_experience',
          },
          null,
          2,
        ),
      );
      response.appendResponseLine('```');
      return;
    }
    if (
      !params.name ||
      typeof params.name !== 'string' ||
      !params.name.trim()
    ) {
      response.appendResponseLine('```json');
      response.appendResponseLine(
        JSON.stringify(
          {
            success: false,
            message: '创建失败：name 为必填字段，且不能为空字符串',
            tooltype: 'create_site_experience',
          },
          null,
          2,
        ),
      );
      response.appendResponseLine('```');
      return;
    }

    try {
      const existing = await siteExperienceService.getByDomain(
        params.domain.trim(),
      );
      if (existing) {
        response.appendResponseLine('```json');
        response.appendResponseLine(
          JSON.stringify(
            {
              success: false,
              message: `域名 ${params.domain.trim()} 已存在（ID: ${existing.id}），请使用 update 更新`,
              tooltype: 'create_site_experience',
              result: existing,
            },
            null,
            2,
          ),
        );
        response.appendResponseLine('```');
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

      response.appendResponseLine('```json');
      response.appendResponseLine(
        JSON.stringify(
          {
            success: true,
            message: `成功创建站点经验 (ID: ${result.id})`,
            tooltype: 'create_site_experience',
            result,
          },
          null,
          2,
        ),
      );
      response.appendResponseLine('```');
    } catch (error) {
      response.appendResponseLine('```json');
      response.appendResponseLine(
        JSON.stringify(
          {
            success: false,
            message: `创建失败：${error instanceof Error ? error.message : String(error)}`,
            tooltype: 'create_site_experience',
          },
          null,
          2,
        ),
      );
      response.appendResponseLine('```');
    }
  },
});

/**
 * 更新站点经验。
 */
export const updateSiteExperience = defineTool({
  name: 'update_site_experience',
  description: 'Update an existing site experience entry',
  annotations: {category: ToolCategory.DATA, readOnlyHint: false},
  schema: {
    id: zod.number().describe('Site experience ID to update'),
    name: zod.string().optional().describe('Updated site name'),
    aliases: zod
      .array(zod.string())
      .optional()
      .describe('Updated domain aliases'),
    platformFeatures: zod
      .string()
      .optional()
      .describe('Updated platform features'),
    validPatterns: zod.string().optional().describe('Updated valid patterns'),
    knownPitfalls: zod.string().optional().describe('Updated known pitfalls'),
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
        response.appendResponseLine('```json');
        response.appendResponseLine(
          JSON.stringify(
            {
              success: false,
              message: `未找到 ID 为 ${params.id} 的站点经验`,
              tooltype: 'update_site_experience',
            },
            null,
            2,
          ),
        );
        response.appendResponseLine('```');
        return;
      }

      response.appendResponseLine('```json');
      response.appendResponseLine(
        JSON.stringify(
          {
            success: true,
            message: `成功更新站点经验 (ID: ${result.id})`,
            tooltype: 'update_site_experience',
            result,
          },
          null,
          2,
        ),
      );
      response.appendResponseLine('```');
    } catch (error) {
      response.appendResponseLine('```json');
      response.appendResponseLine(
        JSON.stringify(
          {
            success: false,
            message: `更新失败：${error instanceof Error ? error.message : String(error)}`,
            tooltype: 'update_site_experience',
          },
          null,
          2,
        ),
      );
      response.appendResponseLine('```');
    }
  },
});

/**
 * 删除站点经验。
 */
export const deleteSiteExperience = defineTool({
  name: 'delete_site_experience',
  description: 'Delete a site experience entry by ID',
  annotations: {category: ToolCategory.DATA, readOnlyHint: false},
  schema: {
    id: zod.number().describe('Site experience ID to delete'),
  },
  handler: async (request, response) => {
    const {id} = request.params;

    try {
      const deleted = await siteExperienceService.delete(id);

      if (!deleted) {
        response.appendResponseLine('```json');
        response.appendResponseLine(
          JSON.stringify(
            {
              success: false,
              message: `未找到 ID 为 ${id} 的站点经验`,
              tooltype: 'delete_site_experience',
            },
            null,
            2,
          ),
        );
        response.appendResponseLine('```');
        return;
      }

      response.appendResponseLine('```json');
      response.appendResponseLine(
        JSON.stringify(
          {
            success: true,
            message: `成功删除站点经验 (ID: ${id})`,
            tooltype: 'delete_site_experience',
          },
          null,
          2,
        ),
      );
      response.appendResponseLine('```');
    } catch (error) {
      response.appendResponseLine('```json');
      response.appendResponseLine(
        JSON.stringify(
          {
            success: false,
            message: `删除失败：${error instanceof Error ? error.message : String(error)}`,
            tooltype: 'delete_site_experience',
          },
          null,
          2,
        ),
      );
      response.appendResponseLine('```');
    }
  },
});

/**
 * 列出所有站点经验。
 */
export const listSiteExperiences = defineTool({
  name: 'list_site_experiences',
  description: 'List all site experience entries',
  annotations: {category: ToolCategory.DATA, readOnlyHint: true},
  schema: {},
  handler: async (_request, response) => {
    try {
      const results = await siteExperienceService.listAll();
      response.appendResponseLine('```json');
      response.appendResponseLine(
        JSON.stringify(
          {
            success: true,
            message: `共 ${results.length} 条站点经验`,
            tooltype: 'list_site_experiences',
            results,
          },
          null,
          2,
        ),
      );
      response.appendResponseLine('```');
    } catch (error) {
      response.appendResponseLine('```json');
      response.appendResponseLine(
        JSON.stringify(
          {
            success: false,
            message: `获取列表失败：${error instanceof Error ? error.message : String(error)}`,
            tooltype: 'list_site_experiences',
            results: [],
          },
          null,
          2,
        ),
      );
      response.appendResponseLine('```');
    }
  },
});
