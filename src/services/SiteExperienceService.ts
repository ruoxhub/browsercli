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
   * 数据库未连接时的进程内回退存储，保证 *_site_experience 工具仍可工作。
   */
  private memoryStore: SiteExperience[] = [];
  private memoryIdSeq = 1;

  /** 数据库未初始化时使用内存回退。 */
  private isMemoryMode(): boolean {
    return !dbService.isReady();
  }

  private nextMemoryId(): number {
    return this.memoryIdSeq++;
  }

  /**
   * 搜索站点经验（按 URL 或名称）
   */
  async search(params: {
    url?: string;
    name?: string;
  }): Promise<SiteExperience[]> {
    if (this.isMemoryMode()) {
      return this.searchMemory(params);
    }
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

  private searchMemory(params: {
    url?: string;
    name?: string;
  }): SiteExperience[] {
    const {url, name} = params;
    return this.memoryStore.filter(item => {
      if (url) {
        const domain = this.extractDomain(url) ?? '';
        return domain.length > 0 && item.domain.includes(domain);
      }
      if (name) {
        return item.name === name || item.name.includes(name);
      }
      return true;
    });
  }

  /**
   * 根据 ID 获取站点经验
   */
  async getById(id: number): Promise<SiteExperience | null> {
    if (this.isMemoryMode()) {
      return this.memoryStore.find(s => s.id === id) ?? null;
    }
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
    if (this.isMemoryMode()) {
      return this.memoryStore.find(s => s.domain === domain) ?? null;
    }
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
    if (this.isMemoryMode()) {
      const row: SiteExperience = {
        id: this.nextMemoryId(),
        domain: data.domain,
        name: data.name,
        aliases: (data.aliases as string[] | null) ?? [],
        platformFeatures: data.platformFeatures ?? null,
        validPatterns: data.validPatterns ?? null,
        knownPitfalls: data.knownPitfalls ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.memoryStore.push(row);
      logger.info(
        `[SiteExperienceService] Created experience (memory) for domain: ${data.domain}`,
      );
      return row;
    }

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
    if (this.isMemoryMode()) {
      const idx = this.memoryStore.findIndex(s => s.id === id);
      if (idx < 0) return null;
      const merged: SiteExperience = {
        ...this.memoryStore[idx],
        ...(data as Partial<SiteExperience>),
        updatedAt: new Date(),
      };
      this.memoryStore[idx] = merged;
      logger.info(
        `[SiteExperienceService] Updated experience (memory) id: ${id}`,
      );
      return merged;
    }

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
    if (this.isMemoryMode()) {
      const idx = this.memoryStore.findIndex(s => s.id === id);
      if (idx < 0) return false;
      this.memoryStore.splice(idx, 1);
      logger.info(
        `[SiteExperienceService] Deleted experience (memory) id: ${id}`,
      );
      return true;
    }

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
    if (this.isMemoryMode()) {
      return [...this.memoryStore];
    }
    const db = dbService.getDb();

    try {
      return db.select().from(siteExperiences);
    } catch (error) {
      logger.error('[SiteExperienceService] ListAll failed', error);
      throw error;
    }
  }

  /**
   * 从 URL 提取域名；URL 非法时返回 null，由调用方决定是否继续其他搜索维度。
   */
  private extractDomain(url: string): string | null {
    try {
      const urlWithProtocol = url.startsWith('http') ? url : `http://${url}`;
      return new URL(urlWithProtocol).hostname;
    } catch {
      return null;
    }
  }
}

// 单例导出
export const siteExperienceService = new SiteExperienceService();
