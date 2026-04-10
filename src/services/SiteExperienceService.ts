/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {eq, like, or} from 'drizzle-orm';

import {
  siteExperiences,
  type SiteExperience,
  type NewSiteExperience,
} from '../database/schema.js';
import {logger} from '../utils/logger.js';

import {dbService} from './DatabaseService.js';

/**
 * 站点经验服务 - CRUD 操作
 */
export class SiteExperienceService {
  /**
   * 搜索站点经验（按 URL 或名称）
   */
  async search(params: {
    url?: string;
    name?: string;
  }): Promise<SiteExperience[]> {
    const db = dbService.getDb();
    const {url, name} = params;

    try {
      const query = db.select().from(siteExperiences);

      if (url) {
        // 从 URL 提取域名
        const domain = this.extractDomain(url);
        if (domain) {
          return query.where(
            or(
              eq(siteExperiences.domain, domain),
              like(siteExperiences.domain, `%${domain}%`),
            ),
          );
        }
      }

      if (name) {
        return query.where(
          or(
            eq(siteExperiences.name, name),
            like(siteExperiences.name, `%${name}%`),
          ),
        );
      }

      // 无参数时返回所有记录
      return query;
    } catch (error) {
      logger.error('[SiteExperienceService] Search failed', error);
      throw error;
    }
  }

  /**
   * 根据 ID 获取站点经验
   */
  async getById(id: number): Promise<SiteExperience | null> {
    const db = dbService.getDb();

    try {
      const results = await db
        .select()
        .from(siteExperiences)
        .where(eq(siteExperiences.id, id))
        .limit(1);

      return results[0] || null;
    } catch (error) {
      logger.error('[SiteExperienceService] GetById failed', error);
      throw error;
    }
  }

  /**
   * 根据域名获取站点经验
   */
  async getByDomain(domain: string): Promise<SiteExperience | null> {
    const db = dbService.getDb();

    try {
      const results = await db
        .select()
        .from(siteExperiences)
        .where(eq(siteExperiences.domain, domain))
        .limit(1);

      return results[0] || null;
    } catch (error) {
      logger.error('[SiteExperienceService] GetByDomain failed', error);
      throw error;
    }
  }

  /**
   * 创建站点经验
   */
  async create(data: NewSiteExperience): Promise<SiteExperience> {
    const db = dbService.getDb();

    try {
      const results = await db
        .insert(siteExperiences)
        .values({
          ...data,
          updatedAt: new Date(),
        })
        .returning();

      logger.info(
        `[SiteExperienceService] Created experience for domain: ${data.domain}`,
      );
      return results[0];
    } catch (error) {
      logger.error('[SiteExperienceService] Create failed', error);
      throw error;
    }
  }

  /**
   * 更新站点经验
   */
  async update(
    id: number,
    data: Partial<NewSiteExperience>,
  ): Promise<SiteExperience | null> {
    const db = dbService.getDb();

    try {
      const results = await db
        .update(siteExperiences)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(eq(siteExperiences.id, id))
        .returning();

      if (results.length === 0) {
        return null;
      }

      logger.info(`[SiteExperienceService] Updated experience id: ${id}`);
      return results[0];
    } catch (error) {
      logger.error('[SiteExperienceService] Update failed', error);
      throw error;
    }
  }

  /**
   * 删除站点经验
   */
  async delete(id: number): Promise<boolean> {
    const db = dbService.getDb();

    try {
      const results = await db
        .delete(siteExperiences)
        .where(eq(siteExperiences.id, id))
        .returning({id: siteExperiences.id});

      const deleted = results.length > 0;
      if (deleted) {
        logger.info(`[SiteExperienceService] Deleted experience id: ${id}`);
      }
      return deleted;
    } catch (error) {
      logger.error('[SiteExperienceService] Delete failed', error);
      throw error;
    }
  }

  /**
   * 列出所有站点经验
   */
  async listAll(): Promise<SiteExperience[]> {
    const db = dbService.getDb();

    try {
      return db.select().from(siteExperiences);
    } catch (error) {
      logger.error('[SiteExperienceService] ListAll failed', error);
      throw error;
    }
  }

  /**
   * 从 URL 提取域名
   */
  private extractDomain(url: string): string | null {
    try {
      // 如果 URL 没有协议，添加 http:// 以便解析
      const urlWithProtocol = url.startsWith('http') ? url : `http://${url}`;
      const parsed = new URL(urlWithProtocol);
      return parsed.hostname;
    } catch {
      // 如果不是有效 URL，返回原始输入
      return url;
    }
  }
}

// 单例导出
export const siteExperienceService = new SiteExperienceService();
