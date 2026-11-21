import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { site } from '../config';
import { excerpt, getAllPosts, postDate, postHref } from '../lib/site';

/** 生成 /rss.xml：链接全部使用绝对地址，兼容 GitHub Pages 子路径部署 */
export async function GET(context: APIContext) {
  const siteUrl = context.site ?? new URL('https://example.github.io');
  const posts = await getAllPosts();

  return rss({
    title: site.title,
    description: site.description,
    site: siteUrl,
    trailingSlash: false,
    customData: `<language>${site.locale}</language>`,
    items: posts.map((post) => ({
      title: post.data.title,
      description: (post.data.description ?? '').trim() || excerpt(post, 200),
      pubDate: postDate(post),
      link: new URL(postHref(post), siteUrl).toString(),
      categories: [...(post.data.tags ?? [])],
      author: site.author.name,
    })),
  });
}
