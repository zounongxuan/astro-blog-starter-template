import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * Notion 同步脚本 scripts/notion-sync.mjs 会写入 src/content/posts/*.md。
 * 字段与同步脚本的 frontmatter 输出保持一致。
 */
const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional().default(''),
    date: z.coerce.date().optional(),
    updated: z.coerce.date().optional(),
    tags: z.array(z.string()).optional().default([]),
    category: z.string().optional(),
    /** 研究阶段：书稿（修订中）/ 工作论文 / 研究笔记 */
    stage: z.string().optional(),
    cover: z.string().optional(),
    /** Notion 页面 id，用于生成回链 */
    notionId: z.string().optional(),
    notionUrl: z.string().optional(),
    draft: z.boolean().optional().default(false),
    /** notion = 自动同步生成；manual = 手写保留 */
    source: z.enum(['notion', 'manual']).optional().default('notion'),
    /** 手动指定排序权重（越大越靠前） */
    weight: z.number().optional().default(0),
  }),
});

export const collections = { posts };
