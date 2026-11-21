import type { APIRoute } from 'astro';

/**
 * 生成 /robots.txt。
 * Sitemap 使用「站点 origin + BASE_URL + sitemap-index.xml」拼接，
 * 以兼容 GitHub Pages 项目页部署（BASE_URL 形如 /repo，可能不带尾斜杠）。
 */
export const GET: APIRoute = () => {
  const siteUrl = import.meta.env.SITE ?? 'https://example.github.io';
  const origin = new URL(siteUrl).origin;
  const base = import.meta.env.BASE_URL;
  const basePrefix = base.endsWith('/') ? base : `${base}/`;
  const sitemap = `${origin}${basePrefix}sitemap-index.xml`;

  const lines = [
    'User-agent: *',
    'Allow: /',
    `Disallow: ${basePrefix}search`,
    `Disallow: ${basePrefix}404`,
    '',
    `Sitemap: ${sitemap}`,
    '',
  ];

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
};
