import type { APIRoute } from 'astro';
import { getAllPosts, isoDate, postHref } from '../lib/site';

/** 把 Markdown 正文粗洗成纯文本，供客户端搜索使用 */
function plainText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$[^$\n]*\$/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/[*_~>#|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 生成 /search-index.json：标题、摘要、标签、分类、日期、URL 与正文前 800 字 */
export const GET: APIRoute = async () => {
  const posts = await getAllPosts();

  const index = posts.map((post) => ({
    title: post.data.title,
    description: (post.data.description ?? '').trim(),
    tags: post.data.tags ?? [],
    category: post.data.category ?? '',
    date: isoDate(post.data.date ?? post.data.updated),
    url: postHref(post),
    body: plainText(post.body ?? '').slice(0, 800),
  }));

  return new Response(JSON.stringify(index), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
};
