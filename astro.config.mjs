// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';

/**
 * 站点地址与子路径。
 * - 本地开发：默认 https://example.github.io / 根路径
 * - GitHub Pages 项目页：由 Actions 注入 SITE_URL=https://<user>.github.io/<repo>、BASE_PATH=/<repo>
 * - 自定义域名：在仓库变量里设置 SITE_URL，BASE_PATH 留空即可
 */
const rawSite = (process.env.SITE_URL || 'https://example.github.io').replace(/\/+$/, '');
const base = normalizeBase(process.env.BASE_PATH);

function normalizeBase(input) {
  if (!input || input === '/' || input === '') return '/';
  let b = input.trim();
  if (!b.startsWith('/')) b = '/' + b;
  return b.replace(/\/+$/, '');
}

/**
 * Markdown 里根路径图片（/notion-assets/...）在 GitHub Pages 子路径部署时
 * 需要自动补上 BASE_PATH，否则会出现 404。
 */
function rehypeBaseImages() {
  /** @param {any} node */
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'element' && (node.tagName === 'img' || node.tagName === 'source')) {
      const props = node.properties || {};
      if (typeof props.src === 'string' && props.src.startsWith('/')) {
        props.src = joinBase(base, props.src);
      }
      if (typeof props.srcset === 'string') {
        props.srcset = props.srcset
          .split(',')
          .map((part) => {
            const [url, ...rest] = part.trim().split(/\s+/);
            return [joinBase(base, url), ...rest].join(' ');
          })
          .join(', ');
      }
    }
    if (Array.isArray(node.children)) node.children.forEach(walk);
  };
  return (tree) => walk(tree);
}

function joinBase(b, url) {
  if (b === '/') return url;
  return `${b}${url}`;
}

export default defineConfig({
  site: rawSite,
  base,
  trailingSlash: 'ignore',
  build: {
    format: 'directory',
  },
  markdown: {
    remarkPlugins: [remarkMath],
    rehypePlugins: [
      rehypeSlug,
      [rehypeAutolinkHeadings, { behavior: 'wrap', properties: { className: ['heading-anchor'] } }],
      rehypeKatex,
      rehypeBaseImages,
    ],
    shikiConfig: {
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
      defaultColor: false,
      wrap: true,
    },
  },
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/404') && !page.includes('/search'),
    }),
  ],
  vite: {
    build: {
      // 让 markdown 内联 SVG 之类的资源可控
      assetsInlineLimit: 2048,
    },
  },
});
