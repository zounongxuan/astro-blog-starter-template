/**
 * 站点全局配置 —— 想改站名、简介、导航、社交链接，只改这里。
 * 修改后无需重新同步 Notion，重新构建即可。
 */
export const site = {
  title: 'skill-worth · 理论研究',
  /** 站名首字方印（Logo 与首页水印） */
  brandMark: '理',
  /** Logo 下方的英文副标 */
  brandSub: 'SKILL-WORTH · THEORY',
  /** 首页大标题下的一句话 */
  tagline: '从雇佣到任务交付：一个关于劳动、组织与制度重构的长期研究。',
  description:
    'skill-worth 理论研究站：任务型社会、任务型劳动关系、技能资产与制度重构的书稿、论文与研究进展。',
  author: {
    name: '邹龙轩',
    bio: '务本咨询 · 任务型社会与任务型劳动关系研究。',
    email: '',
  },
  /** Open Graph 分享图（public/ 下的绝对路径） */
  ogImage: '/og-default.png',
  /** 导航：href 为站内路径（会自动补上部署子路径） */
  nav: [
    { label: '文章', href: '/posts' },
    { label: '系列', href: '/series' },
    { label: '归档', href: '/archive' },
    { label: '标签', href: '/tags' },
    { label: '搜索', href: '/search' },
    { label: '关于', href: '/about' },
    { label: '课程', href: 'https://skill-worth.com/courses' },
    { label: '主站 ↗', href: 'https://skill-worth.com' },
  ],
  socials: [
    { label: 'GitHub', href: 'https://github.com/zounongxuan/astro-blog-starter-template', icon: 'github' },
    { label: '官网 skill-worth.com', href: 'https://skill-worth.com', icon: 'link' },
    { label: 'RSS', href: '/rss.xml', icon: 'rss' },
  ],
  /** 首页「精选」：按 Notion 页面标题或 slug 精确匹配，可留空 */
  featured: [],
  locale: 'zh-CN',
  /** 每页文章数（首页取 6 篇最新，/posts 页不分页） */
  postsPerPage: 6,
  /** Cloudflare Web Analytics（公开 beacon token；构建环境变量 PUBLIC_CF_ANALYTICS_TOKEN 可覆盖） */
  analytics: {
    cfBeaconToken: '625d565baf5f4368aec9739d3783ebb1',
  },
  /** 是否在文章页显示「在 Notion 中查看」 */
  showNotionLink: false,
} as const;

export type NavItem = (typeof site.nav)[number];
