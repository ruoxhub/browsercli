
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { pgTable, serial, varchar, text, timestamp, index } from 'drizzle-orm/pg-core';

/**
 * 站点经验表
 * 存储特定网站的操作经验和模式
 */
export const siteExperiences = pgTable('site_experiences', {
  id: serial('id').primaryKey(),
  domain: varchar('domain', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  aliases: text('aliases').array().default([]),
  platformFeatures: text('platform_features'),
  validPatterns: text('valid_patterns'),
  knownPitfalls: text('known_pitfalls'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  idxName: index('idx_site_experiences_name').on(table.name),
  idxDomain: index('idx_site_experiences_domain').on(table.domain),
}));

export type SiteExperience = typeof siteExperiences.$inferSelect;
export type NewSiteExperience = typeof siteExperiences.$inferInsert;
