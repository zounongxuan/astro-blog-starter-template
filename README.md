# 灵感与理论库 · Notion → 网站自动化流水线

把你的 Notion 变成一座会自动更新的个人知识站：

```
Notion（灵感与理论库）
        │  ① npm run sync
        ▼
Markdown 文件（src/content/posts/*.md）
        │  ② 写入本地网站目录
        ▼
Astro 静态站点（dist/）
        │  ③ npm run publish = 构建校验 + git commit + git push
        ▼
GitHub Actions（push 触发 / 每天定时）
        │  ④ 构建 + Deploy to GitHub Pages
        ▼
https://<用户名>.github.io/<仓库名>/
```

**你只需要在 Notion 里写，发布交给流水线。**

---

## 1. 目录速览

```
├─ .github/workflows/deploy.yml   # CI：同步 Notion → 构建 → 部署 Pages
├─ scripts/
│  ├─ notion-sync.mjs             # Notion → Markdown 同步器（零依赖）
│  ├─ publish.mjs                 # 一键：同步 + 构建 + 提交推送
│  └─ test/run-sync-mock.mjs      # 本地 mock Notion API 集成测试
├─ src/
│  ├─ config.ts                   # 站名、简介、导航、社交链接（改这里）
│  ├─ content.config.ts           # 文章 frontmatter schema
│  ├─ lib/site.ts                 # 排序、标签、日期、阅读时长等工具
│  ├─ content/posts/              # 同步生成的 Markdown（自动写入）
│  ├─ layouts/ components/ pages/ # 页面与组件
│  └─ styles/global.css           # 设计系统
├─ public/notion-assets/          # 自动下载的 Notion 图片
└─ astro.config.mjs               # 站点 URL、子路径、Markdown 插件
```

---

## 2. 一次性配置（10 分钟）

### 2.1 创建 Notion Integration

1. 打开 <https://www.notion.so/my-integrations> → **New integration** → 选择你的 workspace → 提交。
2. 复制 **Internal Integration Secret**（`secret_` 或 `ntn_` 开头）。
3. 在 Notion 中打开你的「灵感与理论库」页面/数据库 → 右上角 `···` → **Connections（连接）** → 添加刚才的 integration。
   - 如果是一个**数据库**：把数据库链接（或 32 位 ID）配置到 `NOTION_DATABASE_ID`。
   - 如果是一个**页面 + 子页面树**：把页面链接配置到 `NOTION_PAGE_ID`。
   - 两种都支持；数据库里的每一行 = 一篇文章，页面树里的每个子页面 = 一篇文章。

### 2.2 填写本地 `.env`

```powershell
Copy-Item .env.example .env
```

然后编辑 `.env`：

```ini
NOTION_TOKEN=secret_xxx
NOTION_DATABASE_ID=https://www.notion.so/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# 或 NOTION_PAGE_ID=...
```

> `.env` 已在 `.gitignore` 中，不会被提交。

支持的可选配置（见 `.env.example`）：日期/标签/分类/摘要属性名映射、是否下载图片等。
默认会自动识别 title、第一个 date、第一个 multi_select、第一个 select 属性。

### 2.3 准备 GitHub 仓库

```powershell
git init
git add -A
git commit -m "chore: init notion garden"
git remote add origin https://github.com/<用户名>/<仓库名>.git
git push -u origin main
```

仓库 → **Settings → Pages → Build and deployment → Source = GitHub Actions**（只需要点一次）。
如果你用的是 `<用户名>.github.io` 仓库，站点地址就是根域名；否则是 `/<仓库名>/` 子路径，构建脚本会自动处理。

> ⚠️ **私有仓库 + GitHub Pages**：GitHub 对私有仓库的 Pages 需要 Pro/Team 及以上计划。
> 免费账户请把仓库改为 public（站点内容本来就是公开的），或改用 Cloudflare Pages / Vercel 部署。
> 未启用 Pages 时，Actions 会在「配置 GitHub Pages」一步失败，日志提示 `Create Pages site failed`。

### 2.4 配置仓库 Secrets（让 CI 也能自己同步 Notion）

仓库 → **Settings → Secrets and variables → Actions → New repository secret**：

| Name | 值 |
| --- | --- |
| `NOTION_TOKEN` | 你的 integration token |
| `NOTION_DATABASE_ID` 或 `NOTION_PAGE_ID` | 数据库/页面链接或 ID |

配置后：每天 UTC 03:00（北京时间 11:00）Actions 会自动从 Notion 拉取新内容、提交、重新部署——完全不用开电脑。
没配置也能用，只是 CI 里不会自动同步。

---

## 3. 日常使用

### 写作 → 发布（本地一条命令）

```powershell
npm run publish
```

它会依次执行：

1. `node scripts/notion-sync.mjs` —— 从 Notion 增量同步（没改动的页面直接跳过；
   `--force` 强制全量；`--dry-run` 只预览）。
2. `npm run build` —— 本地构建校验，提前暴露 Markdown/依赖问题。
3. `git add -A && git commit && git push` —— 提交并推送。
4. GitHub Actions 收到推送后自动构建并发布。

### 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 本地预览站点（http://localhost:4321） |
| `npm run sync` | 只同步 Notion → Markdown |
| `npm run sync -- --dry-run --verbose` | 预览同步计划，不写文件 |
| `npm run sync -- --force` | 忽略缓存全量重拉 |
| `npm run sync -- --print <pageId>` | 打印某个 Notion 页面转换后的 Markdown（调试转换器） |
| `npm run build` | 只构建静态站点到 `dist/` |
| `npm run preview` | 本地预览构建产物 |
| `npm run test:sync` | 用 mock Notion API 跑一遍转换/图片/frontmatter 全链路测试 |
| `npm run publish` | 同步 + 构建 + 提交推送 |
| `npm run push:api` | git 通道不稳定（408 / connection reset）时，改用 GitHub API 推送 |

### 排除不想公开的页面

在 `.env` 里加 `NOTION_EXCLUDE_TITLES=内部,台账,报价,合同`（英文逗号分隔），
标题包含这些关键词的页面不会被同步，也不会出现在网站上。

### git push 失败怎么办

国内网络访问 `github.com:443` 时常出现 `408` / `connection reset`。仓库内置了 API 兜底推送：

```powershell
$env:GITHUB_TOKEN="github_pat_xxx"   # 或在 .env 里配置 GITHUB_TOKEN
npm run push:api
```

它走 `api.github.com`（通常更稳定），通过 Git Data API 上传文件树并更新 main。

### 同步规则（记住这几条）

- **数据库里的每一行**（或**页面树里的每个子页面**）会变成 `src/content/posts/<日期>-<标题>.md`。
- Notion 页面里的图片/封面会下载到 `public/notion-assets/`，避免 Notion 临时链接过期。
- 页面删除后，下次同步会自动删除对应的 Markdown 文件。
- `草稿` / `draft` 勾选框为 true 的页面会同步但不会出现在网站上（frontmatter `draft: true`）。
- 手写文章可以放在 `src/content/posts/`（`source: manual`），不会被同步器删除。

---

## 4. 网站定制

| 想改什么 | 改哪里 |
| --- | --- |
| 站名 / 简介 / 导航 / 作者 / RSS | `src/config.ts` |
| 配色 / 字体 / 间距 / 深色模式 | `src/styles/global.css` 里的 CSS 变量 |
| 页面结构与文案 | `src/pages/**`、`src/components/**` |
| 域名 | 仓库变量 `SITE_URL` / `BASE_PATH`（见下） |

### 自定义域名

以 **theory.skill-worth.com** 为例（新站挂子域名，主站不受影响）：

1. 在仓库里保留 `public/CNAME`（内容写 `theory.skill-worth.com`），构建时会按根路径输出。
2. 仓库 → Settings → Pages → **Custom domain** 填 `theory.skill-worth.com` 并保存，等待 DNS 检查通过后勾选 **Enforce HTTPS**。
3. DNS 服务商（这里是 Cloudflare）添加记录：

   | 类型 | 名称 | 内容 | 代理状态 |
   | --- | --- | --- | --- |
   | CNAME | `theory` | `zounongxuan.github.io` | **DNS only（关闭橙色云朵）** |
   | CNAME | `www` | `zounongxuan.github.io` | 仅当用 www 做自定义域时需要 |

   > GitHub Pages 需要直接签发证书，Cloudflare 代理（橙色云朵）会拦截验证，必须设为 **DNS only**。
4. 也可以不建 CNAME 文件，改用仓库 Variables：`SITE_URL=https://theory.skill-worth.com`、`BASE_PATH=/`。

---

## 5. 工作原理（给未来的你）

### 同步器（`scripts/notion-sync.mjs`）

- 零 npm 依赖，使用 Node 内置 `fetch` + Notion REST API（`2022-06-28` 版本）。
- 分页读取数据库/页面树、递归读取 block children，429/5xx 自动重试退避。
- Block → Markdown 支持：段落、H1–H3、无序/有序/待办/折叠列表、引用、callout、代码块（语言映射）、
  公式（行内 + 块级）、图片/视频/文件、书签、链接预览、表格（含竖线转义）、分栏、同步块、子页面、分隔线。
- 富文本支持：加粗、斜体、删除线、下划线、行内代码、链接、公式、页面 mention。
- 增量同步：`.notion-cache/sync-manifest.json` 记录每页 `last_edited_time` + 生成文件 + 图片清单；
  未变化的页面直接跳过。清单是本地缓存，不入库。
- 图片按内容 URL 哈希命名去重，已存在则复用。

### 构建（Astro 5）

- Content Collections + Markdown，Shiki 代码高亮（light/dark 双主题）、KaTeX 公式、rehype 自动标题锚点。
- `SITE_URL` / `BASE_PATH` 环境变量控制 canonical 与子路径；Markdown 里的 `/notion-assets/...`
  会在构建时自动补上子路径（`rehypeBaseImages`）。
- RSS、sitemap、客户端搜索索引（`/search-index.json`）都在构建时生成。

### 部署（GitHub Actions）

- `push` 到 `main` → 构建 → 上传 Pages artifact → 部署。
- 每天定时 → 可选地从 Notion 同步并提交，再构建部署。
- 也可以在 Actions 页面手动 **Run workflow**。

---

## 6. 常见问题

**同步报 401/404？**
确认 integration 已被「连接」到目标页面/数据库（Notion 里 `···` → Connections），以及 ID 正确。
数据库 ID 可以贴完整 URL，脚本会自动提取。

**图片没显示？**
确认 `public/notion-assets/` 已提交；`NOTION_DOWNLOAD_IMAGES=true`（默认）。
如果图片下载失败，会退化为引用 Notion 原链接（约 1 小时过期，不推荐）。

**Actions 部署后 404 / 样式丢失？**
检查 `BASE_PATH` 是否与仓库类型匹配：`<用户名>.github.io` 仓库用 `/`，普通仓库用 `/<仓库名>`。
`deploy.yml` 会自动计算，通常不需要手动改。

**页面标题里的特殊字符导致文件名奇怪？**
文件名会做 slug 化（保留中英文数字，空格转 `-`）。同一天同名页面会自动加 `-2` 后缀。

**想换主题但不想动样式？**
改 `src/config.ts` 即可；更深的视觉定制集中在 `src/styles/global.css` 的变量和 `src/components/`。

---

## 7. 安全提醒

- `NOTION_TOKEN`、GitHub PAT 只放在本地 `.env` 或 GitHub Secrets，**不要写进仓库**。
- `.env`、`.notion-cache/`、`node_modules/`、`dist/` 都已在 `.gitignore` 中。
- 建议使用 Notion integration 的只读权限，以及 GitHub fine-grained PAT（仅 `contents: write`）。
