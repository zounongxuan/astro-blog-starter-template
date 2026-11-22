import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'posts'>;

const BASE = import.meta.env.BASE_URL;

/** 把站内路径接到部署子路径上（GitHub Pages 项目页需要） */
export function withBase(path = '/') {
  const b = BASE.endsWith('/') ? BASE.slice(0, -1) : BASE;
  if (!path || path === '/') return `${b}/`;
  return `${b}${path.startsWith('/') ? path : `/${path}`}`;
}

export function formatDate(input: Date | string | undefined, style: 'long' | 'short' = 'long') {
  if (!input) return '';
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  const fmt = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: style === 'long' ? 'long' : '2-digit',
    day: style === 'long' ? 'numeric' : '2-digit',
  });
  return fmt.format(d);
}

export function isoDate(input: Date | string | undefined) {
  if (!input) return '';
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/** 中文阅读速度约 350 字/分钟，中英混排统一估算 */
export function readingTime(markdown = '') {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~\-|]/g, ' ');
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const words = (text.replace(/[\u4e00-\u9fff]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length;
  const minutes = Math.max(1, Math.round(cjk / 350 + words / 220));
  return minutes;
}

export function postDate(post: Post): Date {
  const raw = post.data.date ?? post.data.updated;
  if (!raw) return new Date(0);
  return raw instanceof Date ? raw : new Date(raw);
}

/** 全部已发布文章，按时间倒序（同日按 weight、标题） */
export async function getAllPosts(): Promise<Post[]> {
  const posts = await getCollection('posts', ({ data }) => !data.draft);
  return posts.sort((a, b) => {
    const diff = postDate(b).getTime() - postDate(a).getTime();
    if (diff !== 0) return diff;
    const w = (b.data.weight ?? 0) - (a.data.weight ?? 0);
    if (w !== 0) return w;
    return a.data.title.localeCompare(b.data.title, 'zh-CN');
  });
}

export function getTags(posts: Post[]) {
  const map = new Map<string, number>();
  for (const post of posts) {
    for (const tag of post.data.tags ?? []) {
      map.set(tag, (map.get(tag) ?? 0) + 1);
    }
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count, slug: tagSlug(name) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
}

export function getCategories(posts: Post[]) {
  const map = new Map<string, number>();
  for (const post of posts) {
    const c = post.data.category?.trim();
    if (c) map.set(c, (map.get(c) ?? 0) + 1);
  }
  return [...map.entries()].map(([name, count]) => ({ name, count, slug: tagSlug(name) }));
}

/** 标签/分类 → URL 安全 slug：保留中英文数字，空白转 - */
export function tagSlug(input: string) {
  const slug = input
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[\\/?#%<>*:|"'`~!@$^&()+=,[\]{};]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug.slice(0, 48) || 'tag';
}

export function tagHref(name: string) {
  return withBase(`/tags/${encodeURIComponent(tagSlug(name))}/`);
}

/** 文章详情页链接 */
export function postHref(post: Post) {
  return withBase(`/posts/${encodeURIComponent(post.id)}/`);
}

export function excerpt(post: Post, len = 120) {
  const d = (post.data.description ?? '').trim();
  if (d) return d;
  const body = (post.body ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_`|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return body.slice(0, len) + (body.length > len ? '…' : '');
}

/** 上一篇 / 下一篇（按时间倒序集合中相对位置） */
export function neighbors(posts: Post[], current: Post) {
  const idx = posts.findIndex((p) => p.id === current.id);
  return {
    newer: idx > 0 ? posts[idx - 1] : undefined,
    older: idx >= 0 && idx < posts.length - 1 ? posts[idx + 1] : undefined,
  };
}

/** 中文数字 / 阿拉伯数字解析（用于书稿章节排序） */
const CN_DIGITS: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
  百: 100,
};

function parseNumber(text: string): number {
  if (/^\d+$/.test(text)) return Number(text);
  let value = 0;
  for (const char of text) {
    const digit = CN_DIGITS[char];
    if (digit === undefined) continue;
    if (digit === 10) value = value === 0 ? 10 : value * 10;
    else if (digit === 100) value = (value || 1) * 100;
    else value += digit;
  }
  return value || 999;
}

/** 书稿/系列的阅读顺序：目录 → 导论 → 第 N 章/阶段 → 其他 */
export function seriesOrder(title: string): number {
  if (/目录/.test(title)) return -2;
  if (/导论|导言|前言|总览/.test(title)) return -1;
  const match = title.match(/第([一二三四五六七八九十百\d]+)(章|阶段)/);
  if (match) return parseNumber(match[1]);
  if (/^十五个阶段/.test(title)) return 0;
  return 500;
}

/** 按系列顺序排序（目录/导论在前，章节按数字升序） */
export function sortSeries(posts: Post[]): Post[] {
  return [...posts].sort((a, b) => {
    const diff = seriesOrder(a.data.title) - seriesOrder(b.data.title);
    if (diff !== 0) return diff;
    return a.data.title.localeCompare(b.data.title, 'zh-CN');
  });
}

export function sortByYear(posts: Post[]) {
  const groups = new Map<string, Post[]>();
  for (const post of posts) {
    const year = postDate(post).getFullYear() || '未标注';
    const key = String(year);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(post);
  }
  return [...groups.entries()].sort((a, b) => Number(b[0]) - Number(a[0]));
}
