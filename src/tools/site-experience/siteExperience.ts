/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {siteExperienceService} from '../../services/SiteExperienceService.js';

/** 站点经验操作统一返回结构 */
export interface SiteExperienceResult {
  success: boolean;
  message: string;
  tooltype: string;
  logFormat?: string;
}

/** 搜索参数 */
export interface SearchParams {
  url?: string;
  name?: string;
}

/** 搜索结果 */
export interface SearchResult extends SiteExperienceResult {
  tooltype: 'search_site_experience';
  results: Awaited<ReturnType<typeof siteExperienceService.search>>;
}

/** 创建参数 */
export interface CreateParams {
  domain: string;
  name: string;
  aliases?: string[];
  platformFeatures?: string;
  validPatterns?: string;
  knownPitfalls?: string;
}

/** 创建结果 */
export interface CreateResult extends SiteExperienceResult {
  tooltype: 'create_site_experience';
  result: Awaited<ReturnType<typeof siteExperienceService.create>>;
}

/** 更新参数 */
export interface UpdateParams {
  id: number;
  name?: string;
  aliases?: string[];
  platformFeatures?: string;
  validPatterns?: string;
  knownPitfalls?: string;
}

/** 更新结果 */
export interface UpdateResult extends SiteExperienceResult {
  tooltype: 'update_site_experience';
  result: Awaited<ReturnType<typeof siteExperienceService.update>> | null;
}

/** 删除参数 */
export interface DeleteParams {
  id: number;
}

/** 删除结果 */
export interface DeleteResult extends SiteExperienceResult {
  tooltype: 'delete_site_experience';
}

/** 列表结果 */
export interface ListResult extends SiteExperienceResult {
  tooltype: 'list_site_experiences';
  results: Awaited<ReturnType<typeof siteExperienceService.listAll>>;
}

/**
 * 搜索站点经验。
 */
export async function searchSiteExperience(
  params: SearchParams,
): Promise<SearchResult> {
  const {url, name} = params;

  if (!url && !name) {
    return {
      success: false,
      message: '请提供 url 或 name 参数进行搜索',
      tooltype: 'search_site_experience',
      results: [],
    };
  }

  try {
    const results = await siteExperienceService.search({url, name});
    return {
      success: true,
      message: `找到 ${results.length} 条站点经验`,
      tooltype: 'search_site_experience',
      results,
    };
  } catch (error) {
    return {
      success: false,
      message: `搜索失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'search_site_experience',
      results: [],
    };
  }
}

/**
 * 创建站点经验。
 */
export async function createSiteExperience(
  params: CreateParams,
): Promise<CreateResult> {
  // 校验必填字段
  if (!params.domain || typeof params.domain !== 'string' || !params.domain.trim()) {
    return {
      success: false,
      message: '创建失败：domain 为必填字段，且不能为空字符串',
      tooltype: 'create_site_experience',
      result: null as unknown as Awaited<ReturnType<typeof siteExperienceService.create>>,
    };
  }
  if (!params.name || typeof params.name !== 'string' || !params.name.trim()) {
    return {
      success: false,
      message: '创建失败：name 为必填字段，且不能为空字符串',
      tooltype: 'create_site_experience',
      result: null as unknown as Awaited<ReturnType<typeof siteExperienceService.create>>,
    };
  }

  try {
    const existing = await siteExperienceService.getByDomain(params.domain.trim());
    if (existing) {
      return {
        success: false,
        message: `域名 ${params.domain.trim()} 已存在（ID: ${existing.id}），请使用 update 更新`,
        tooltype: 'create_site_experience',
        result: existing,
      };
    }

    // 确保 aliases 为数组
    const aliases = Array.isArray(params.aliases) ? params.aliases : [];

    const result = await siteExperienceService.create({
      domain: params.domain.trim(),
      name: params.name.trim(),
      aliases,
      platformFeatures: params.platformFeatures ?? null,
      validPatterns: params.validPatterns ?? null,
      knownPitfalls: params.knownPitfalls ?? null,
    });

    return {
      success: true,
      message: `成功创建站点经验 (ID: ${result.id})`,
      tooltype: 'create_site_experience',
      result,
    };
  } catch (error) {
    return {
      success: false,
      message: `创建失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'create_site_experience',
      result: null as unknown as Awaited<ReturnType<typeof siteExperienceService.create>>,
    };
  }
}

/**
 * 更新站点经验。
 */
export async function updateSiteExperience(
  params: UpdateParams,
): Promise<UpdateResult> {
  try {
    const updateData: Record<string, unknown> = {
      ...(params.name !== undefined && {name: params.name}),
      ...(params.aliases !== undefined && {aliases: params.aliases}),
      ...(params.platformFeatures !== undefined && {platformFeatures: params.platformFeatures}),
      ...(params.validPatterns !== undefined && {validPatterns: params.validPatterns}),
      ...(params.knownPitfalls !== undefined && {knownPitfalls: params.knownPitfalls}),
    };

    const result = await siteExperienceService.update(params.id, updateData);

    if (!result) {
      return {
        success: false,
        message: `未找到 ID 为 ${params.id} 的站点经验`,
        tooltype: 'update_site_experience',
        result: null,
      };
    }

    return {
      success: true,
      message: `成功更新站点经验 (ID: ${result.id})`,
      tooltype: 'update_site_experience',
      result,
    };
  } catch (error) {
    return {
      success: false,
      message: `更新失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'update_site_experience',
      result: null,
    };
  }
}

/**
 * 删除站点经验。
 */
export async function deleteSiteExperience(
  params: DeleteParams,
): Promise<DeleteResult> {
  try {
    const deleted = await siteExperienceService.delete(params.id);

    if (!deleted) {
      return {
        success: false,
        message: `未找到 ID 为 ${params.id} 的站点经验`,
        tooltype: 'delete_site_experience',
      };
    }

    return {
      success: true,
      message: `成功删除站点经验 (ID: ${params.id})`,
      tooltype: 'delete_site_experience',
    };
  } catch (error) {
    return {
      success: false,
      message: `删除失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'delete_site_experience',
    };
  }
}

/**
 * 列出所有站点经验。
 */
export async function listSiteExperiences(): Promise<ListResult> {
  try {
    const results = await siteExperienceService.listAll();
    return {
      success: true,
      message: `共 ${results.length} 条站点经验`,
      tooltype: 'list_site_experiences',
      results,
    };
  } catch (error) {
    return {
      success: false,
      message: `获取列表失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'list_site_experiences',
      results: [],
    };
  }
}
