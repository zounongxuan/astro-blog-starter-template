/**
 * 站点全局配置 —— 想改站名、简介、导航、社交链接，只改这里。
 * 修改后无需重新同步 Notion，重新构建即可。
 */
export const site = {
  title: '灵感与理论库',
  /** 首页大标题下的一句话 */
  tagline: '把 Notion 里的想法、笔记与理论，整理成一座可阅读的数字花园。',
  description:
    '一个持续生长的个人知识站：灵感碎片、阅读笔记、理论模型与长期思考，全部来自我的 Notion。',
  author: {
    name: 'zounongxuan',
    bio: '记录灵感，搭建理论，偶尔写点长文。',
    email: '',
  },
  /** 导航：href 为站内路径（会自动补上部署子路径） */
  nav: [
    { label: '文章', href: '/posts' },
    { label: '归档', href: '/archive' },
    { label: '标签', href: '/tags' },
    { label: '搜索', href: '/search' },
    { label: '关于', href: '/about' },
  ],
  socials: [
    // 填上你的链接即可显示在页脚；不需要就删掉
    { label: 'GitHub', href: 'https://github.com/', icon: 'github' },
    { label: 'RSS', href: '/rss.xml', icon: 'rss' },
  ],
  /** 首页「精选」：按 Notion 页面标题或 slug 精确匹配，可留空 */
  featured: [],
  locale: 'zh-CN',
  /** 每页文章数（首页取 6 篇最新，/posts 页不分页） */
  postsPerPage: 6,
  /** 是否在文章页显示「在 Notion 中查看」 */
  showNotionLink: true,
} as const;

export type NavItem = (typeof site.nav)[number];
