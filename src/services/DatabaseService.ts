/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {drizzle} from 'drizzle-orm/node-postgres';
import {Pool, PoolConfig} from 'pg';

import * as schema from '../database/schema.js';
import {logger} from '../utils/logger.js';

/**
 * 数据库服务 - 管理 PostgreSQL 连接池
 */
export class DatabaseService {
  private pool: Pool | null = null;
  private isConnected = false;

  /**
   * 连接到数据库
   */
  async connect(connectionString: string): Promise<void> {
    if (this.isConnected) {
      logger.info('[DatabaseService] Already connected');
      return;
    }

    try {
      this.pool = new Pool({
        connectionString,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      });

      // 测试连接
      await this.pool.query('SELECT NOW()');
      this.isConnected = true;
      logger.info('[DatabaseService] Connected to PostgreSQL');

      // 监听连接池事件
      this.pool.on('error', (err: Error) => {
        logger.error('[DatabaseService] Unexpected pool error', err);
      });
    } catch (error) {
      logger.error('[DatabaseService] Failed to connect', error);
      throw new Error(`Database connection failed: ${error}`);
    }
  }

  /**
   * 获取数据库实例（带 schema）
   */
  getDb() {
    if (!this.pool) {
      throw new Error('Database not connected');
    }
    return drizzle(this.pool, {schema});
  }

  /**
   * 获取原生连接池（用于高级操作）
   */
  getPool(): Pool {
    if (!this.pool) {
      throw new Error('Database not connected');
    }
    return this.pool;
  }

  /**
   * 检查是否已连接
   */
  isReady(): boolean {
    return this.isConnected && this.pool !== null;
  }

  /**
   * 关闭连接
   */
  async disconnect(): Promise<void> {
    if (!this.pool) {
      return;
    }

    try {
      await this.pool.end();
      this.pool = null;
      this.isConnected = false;
      logger.info('[DatabaseService] Disconnected from PostgreSQL');
    } catch (error) {
      logger.error('[DatabaseService] Error during disconnect', error);
      throw error;
    }
  }

  /**
   * 执行迁移（创建表）
   */
  async migrate(): Promise<void> {
    if (!this.pool) {
      throw new Error('Database not connected');
    }

    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS site_experiences (
        id SERIAL PRIMARY KEY,
        domain VARCHAR(255) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        aliases TEXT[] DEFAULT '{}',
        platform_features TEXT,
        valid_patterns TEXT,
        known_pitfalls TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_site_experiences_name ON site_experiences(name);
      CREATE INDEX IF NOT EXISTS idx_site_experiences_domain ON site_experiences(domain);
    `;

    try {
      await this.pool.query(createTableQuery);
      logger.info('[DatabaseService] Migration completed');
    } catch (error) {
      logger.error('[DatabaseService] Migration failed', error);
      throw error;
    }
  }
}

// 单例导出
export const dbService = new DatabaseService();
