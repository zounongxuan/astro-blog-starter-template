#!/usr/bin/env node
/**
 * Notion → Markdown 同步脚本
 * ------------------------------------------------------------
 * 从 Notion 数据库（或页面树）读取内容，转换为 Markdown，
 * 写入 src/content/posts/*.md，并把图片下载到 public/notion-assets/。
 *
 * 用法：
 *   node scripts/notion-sync.mjs               # 增量同步
 *   node scripts/notion-sync.mjs --force       # 忽略缓存，全量重拉
 *   node scripts/notion-sync.mjs --dry-run     # 只打印计划，不写文件
 *   node scripts/notion-sync.mjs --print <id>  # 打印某一页转换后的 Markdown
 *   node scripts/notion-sync.mjs --limit 3     # 只同步前 N 篇（调试用）
 *   node scripts/notion-sync.mjs --verbose     # 输出每一页的处理过程
 *
 * 也可以作为模块引用（scripts/test-converter.mjs 用到纯函数）。
 */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

/** 目录可通过环境变量覆盖（测试脚本用它隔离 mock 产物，不污染正式内容） */
const envDir = (key, fallback) =>
  process.env[key] ? path.resolve(ROOT, process.env[key]) : path.join(ROOT, fallback);

export const CONTENT_DIR = envDir('NOTION_CONTENT_DIR', 'src/content/posts');
export const ASSET_DIR = envDir('NOTION_ASSET_DIR', 'public/notion-assets');
export const CACHE_DIR = envDir('NOTION_CACHE_DIR', '.notion-cache');
export const MANIFEST_PATH = path.join(CACHE_DIR, 'sync-manifest.json');

// 可用 NOTION_API_BASE 指向本地 mock（测试用）
let API = process.env.NOTION_API_BASE || 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

/* ------------------------------------------------------------------ */
/* 参数与日志                                                          */
/* ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
const flags = {
  dryRun: argv.includes('--dry-run'),
  force: argv.includes('--force'),
  verbose: argv.includes('--verbose'),
  noImages: argv.includes('--no-images'),
  print: valueOfFlag('--print'),
  limit: Number(valueOfFlag('--limit')) || 0,
};

function valueOfFlag(name) {
  const idx = argv.indexOf(name);
  if (idx === -1) return undefined;
  const next = argv[idx + 1];
  return next && !next.startsWith('--') ? next : '';
}

const log = {
  info: (...args) => console.log(...args),
  detail: (...args) => flags.verbose && console.log('  ', ...args),
  warn: (...args) => console.warn('⚠ ', ...args),
  error: (...args) => console.error('✖ ', ...args),
};

/* ------------------------------------------------------------------ */
/* .env 读取（零依赖）                                                  */
/* ------------------------------------------------------------------ */

export function loadEnv(file = path.join(ROOT, '.env')) {
  const env = { ...process.env };
  let raw = '';
  try {
    raw = fsSync.readFileSync(file, 'utf8');
  } catch {
    return env;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) env[key] = value;
  }
  return env;
}

function requireEnv(env, key, hint) {
  const value = env[key];
  if (!value) {
    throw new Error(
      `缺少环境变量 ${key}。${hint ? `\n  ${hint}` : ''}\n  请在项目根目录的 .env 中填写（参考 .env.example）。`
    );
  }
  return value;
}

/* ------------------------------------------------------------------ */
/* Notion API 客户端：重试 + 分页                                      */
/* ------------------------------------------------------------------ */

let token = '';

async function notionRequest(pathname, { method = 'GET', body, version, retries = 5 } = {}) {
  let attempt = 0;
  for (;;) {
    let res;
    try {
      res = await fetch(`${API}${pathname}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': version || NOTION_VERSION,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      if (attempt++ >= retries) throw new Error(`请求 Notion 失败：${err.message}`);
      await sleep(500 * 2 ** attempt);
      continue;
    }

    if (res.status === 429 || res.status >= 500) {
      if (attempt++ >= retries) {
        throw new Error(`Notion API ${res.status}：${await safeText(res)}`);
      }
      const retryAfter = Number(res.headers.get('retry-after')) || 0;
      await sleep(Math.max(500, retryAfter * 1000) * 2 ** attempt * 0.5);
      continue;
    }

    if (!res.ok) {
      const message = await safeText(res);
      const error = new Error(`Notion API ${res.status} ${pathname}：${message}`);
      error.status = res.status;
      throw error;
    }

    return res.json();
  }
}

async function safeText(res) {
  try {
    return (await res.text()).slice(0, 400);
  } catch {
    return '<no body>';
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listAllChildren(blockId) {
  const results = [];
  let cursor;
  do {
    const query = new URLSearchParams({ page_size: '100' });
    if (cursor) query.set('start_cursor', cursor);
    const data = await notionRequest(`/blocks/${blockId}/children?${query}`);
    results.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return results;
}

async function queryDatabaseAll(databaseId) {
  const results = [];
  let cursor;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const data = await notionRequest(`/databases/${databaseId}/query`, { method: 'POST', body });
    results.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return results;
}

/** Notion 2025-09 之后的新版「数据源（data source）」API 兜底 */
async function queryDataSourceAll(dataSourceId) {
  const results = [];
  let cursor;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const data = await notionRequest(`/data_sources/${dataSourceId}/query`, {
      method: 'POST',
      body,
      version: '2025-09-03',
    });
    results.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return results;
}

/* ------------------------------------------------------------------ */
/* 富文本 → Markdown                                                    */
/* ------------------------------------------------------------------ */

function plainText(richText = []) {
  return richText.map((rt) => rt.plain_text ?? '').join('');
}

function isSafeUrl(url = '') {
  return /^(https?:|mailto:)/i.test(url);
}

export function richTextToMarkdown(richText = []) {
  if (!richText?.length) return '';
  return richText
    .map((rt) => {
      if (rt.type === 'equation') {
        return `$${rt.equation?.expression ?? ''}$`;
      }

      let text = rt.type === 'text' ? rt.text?.content ?? '' : rt.plain_text ?? '';
      if (!text) return '';

      // 处理 URL 自动识别（Notion 中纯文本 URL 没有 href，这里不强行转换）
      const annotations = rt.annotations ?? {};
      if (annotations.code) text = wrapCode(text);
      // 中文排版下 `**加粗**` 紧跟中文/标点时 CommonMark 可能无法闭合，
      // 因此统一输出 HTML 标签，保证在任何位置都能正确渲染。
      if (annotations.bold) text = `<strong>${text}</strong>`;
      if (annotations.italic) text = `<em>${text}</em>`;
      if (annotations.strikethrough) text = `<del>${text}</del>`;
      if (annotations.underline) text = `<u>${text}</u>`;

      if (rt.type === 'text' && rt.text?.link) {
        const url = rt.text.link.url ?? '';
        if (isSafeUrl(url)) text = `[${text}](${url})`;
      }

      if (rt.type === 'mention') {
        const mention = rt.mention ?? {};
        if (mention.type === 'page') {
          const pageId = mention.page?.id;
          const title = plainText(mention.page?.title) || '未命名页面';
          if (pageId) text = `[${title}](${pageUrl(pageId)})`;
        } else if (mention.type === 'database') {
          text = `「${plainText(mention.database?.title) || '数据库'}」`;
        } else if (mention.type === 'link_preview' && mention.link_preview?.url) {
          text = `[${text || mention.link_preview.url}](${mention.link_preview.url})`;
        }
      }

      return text;
    })
    .join('');
}

function wrapCode(text) {
  const fence = text.includes('`') ? '``' : '`';
  return `${fence}${text}${fence}`;
}

function pageUrl(pageId = '') {
  return `https://www.notion.so/${pageId.replace(/-/g, '')}`;
}

/** 把 markdown 里可能破坏表格的字符转义 */
function escapeTableCell(text) {
  return text.replace(/\|/g, '\\|').replace(/\n+/g, '<br>');
}

/* ------------------------------------------------------------------ */
/* Block → Markdown                                                    */
/* ------------------------------------------------------------------ */

const LANGUAGE_MAP = {
  'plain text': '',
  plaintext: '',
  'c++': 'cpp',
  'c#': 'csharp',
  javascript: 'js',
  typescript: 'ts',
  shell: 'bash',
  sh: 'bash',
  'shell script': 'bash',
  powershell: 'powershell',
  json: 'json',
  yaml: 'yaml',
  html: 'html',
  css: 'css',
  scss: 'scss',
  python: 'python',
  java: 'java',
  go: 'go',
  rust: 'rust',
  sql: 'sql',
  markdown: 'md',
  mermaid: 'mermaid',
  latex: 'latex',
  graphql: 'graphql',
  php: 'php',
  ruby: 'ruby',
  swift: 'swift',
  kotlin: 'kotlin',
  dart: 'dart',
  dockerfile: 'dockerfile',
  'docker-compose': 'yaml',
};

function codeLanguage(block) {
  const raw = (block.code?.language ?? '').toLowerCase().trim();
  return LANGUAGE_MAP[raw] ?? raw;
}

const LIST_TYPES = new Set(['bulleted_list_item', 'numbered_list_item', 'to_do']);

/**
 * 转换一组 block 为 Markdown。
 * ctx: { pageId, depth, downloadImage(), blocksOf() }
 */
export async function blocksToMarkdown(blocks = [], ctx = {}) {
  const rendered = [];
  for (const block of blocks) {
    const md = await blockToMarkdown(block, ctx);
    if (md && md.trim()) rendered.push({ md: md.trim(), type: block.type });
  }

  // 连续的同类列表项合并成一个列表（块之间只留单个换行），否则会出现松散列表
  let output = '';
  for (let i = 0; i < rendered.length; i++) {
    const current = rendered[i];
    if (!output) {
      output = current.md;
      continue;
    }
    const previous = rendered[i - 1];
    const merge = LIST_TYPES.has(previous.type) && previous.type === current.type;
    output += (merge ? '\n' : '\n\n') + current.md;
  }
  return output.trim();
}

async function childrenMarkdown(block, ctx, opts = {}) {
  if (!block.has_children) return '';
  const children = await ctx.blocksOf(block.id);
  if (!children?.length) return '';
  const md = await blocksToMarkdown(children, { ...ctx, depth: (ctx.depth ?? 0) + 1 });
  if (!md) return '';
  if (opts.indent) {
    return md
      .split('\n')
      .map((line) => (line.trim() ? `${' '.repeat(opts.indent)}${line}` : ''))
      .join('\n');
  }
  return md;
}

async function blockToMarkdown(block, ctx) {
  const type = block.type;
  const value = block[type] ?? {};

  // Notion 新版本 API 可能出现 heading_4 / heading_5 等更深的标题级别
  const headingMatch = /^heading_([1-6])$/.exec(type);
  if (headingMatch) {
    const level = Number(headingMatch[1]);
    const text = richTextToMarkdown(value.rich_text);
    const children = await childrenMarkdown(block, ctx);
    return `${'#'.repeat(level)} ${text}\n\n${children}`.trim();
  }

  switch (type) {
    case 'paragraph': {
      const text = richTextToMarkdown(value.rich_text);
      const children = await childrenMarkdown(block, ctx);
      return [text, children].filter(Boolean).join('\n\n');
    }

    case 'bulleted_list_item': {
      const text = richTextToMarkdown(value.rich_text);
      const children = await childrenMarkdown(block, ctx, { indent: 2 });
      return `- ${text}${children ? `\n${children}` : ''}`;
    }

    case 'numbered_list_item': {
      const text = richTextToMarkdown(value.rich_text);
      const children = await childrenMarkdown(block, ctx, { indent: 3 });
      return `1. ${text}${children ? `\n${children}` : ''}`;
    }

    case 'to_do': {
      const text = richTextToMarkdown(value.rich_text);
      const children = await childrenMarkdown(block, ctx, { indent: 2 });
      return `- [${value.checked ? 'x' : ' '}] ${text}${children ? `\n${children}` : ''}`;
    }

    case 'toggle': {
      const text = richTextToMarkdown(value.rich_text);
      const children = await childrenMarkdown(block, ctx);
      return `<details>\n<summary>${text}</summary>\n\n${children}\n\n</details>`;
    }

    case 'quote': {
      const text = richTextToMarkdown(value.rich_text);
      const quoted = text
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
      const children = await childrenMarkdown(block, ctx);
      return [quoted, children].filter(Boolean).join('\n\n');
    }

    case 'callout': {
      const text = richTextToMarkdown(value.rich_text);
      const emoji = value.icon?.emoji ?? '';
      const children = await childrenMarkdown(block, ctx);
      const head = `> ${emoji ? `${emoji} ` : ''}${text}`;
      const extra = children
        ? children
            .split('\n')
            .map((line) => (line.trim() ? `> ${line}` : '>'))
            .join('\n')
        : '';
      return [head, extra].filter(Boolean).join('\n> \n');
    }

    case 'code': {
      const language = codeLanguage(block);
      const code = plainText(value.rich_text).replace(/\n+$/, '');
      const fence = code.includes('```') ? '````' : '```';
      return `${fence}${language}\n${code}\n${fence}`;
    }

    case 'equation': {
      const expression = value.expression ?? '';
      return `$$\n${expression}\n$$`;
    }

    case 'divider':
      return '---';

    case 'image':
    case 'video':
    case 'file':
    case 'pdf':
    case 'audio': {
      const file = value.type === 'external' ? value.external : value.file;
      const url = file?.url ?? '';
      if (!url) return '';
      const caption = plainText(value.caption);
      if (type === 'image') {
        const local = await ctx.downloadImage(url, block.id, ctx.pageId);
        return `![${caption || '图片'}](${local})`;
      }
      const label = caption || (type === 'video' ? '视频' : type === 'pdf' ? 'PDF' : '附件');
      return `[${label}](${url})`;
    }

    case 'bookmark':
    case 'link_preview': {
      const url = value.url ?? '';
      const caption = plainText(value.caption) || url;
      return url ? `[${caption}](${url})` : '';
    }

    case 'embed': {
      const url = value.url ?? '';
      return url ? `[嵌入内容](${url})` : '';
    }

    case 'table': {
      return await tableToMarkdown(block, ctx);
    }

    case 'table_row':
      // 表格行由父级 table 统一处理
      return '';

    case 'column_list':
    case 'column': {
      return await childrenMarkdown(block, ctx);
    }

    case 'synced_block': {
      if (block.has_children) return await childrenMarkdown(block, ctx);
      const originalId = value.synced_from?.block_id;
      if (!originalId) return '';
      const children = await ctx.blocksOf(originalId);
      return blocksToMarkdown(children, { ...ctx, depth: (ctx.depth ?? 0) + 1 });
    }

    case 'child_page': {
      const title = value.title || '未命名子页面';
      if (ctx.depth > 2) return `#### ${title}`;
      const children = await ctx.blocksOf(block.id);
      const body = children?.length
        ? await blocksToMarkdown(children, { ...ctx, depth: (ctx.depth ?? 0) + 1 })
        : '';
      return [`#### ${title}`, body].filter(Boolean).join('\n\n');
    }

    case 'child_database': {
      return `> 子数据库「${value.title ?? ''}」未展开。`;
    }

    case 'table_of_contents':
      // 站点会自动生成目录
      return '';

    case 'breadcrumb':
      return '';

    default:
      log.detail(`跳过暂不支持的 block 类型：${type}`);
      return '';
  }
}

async function tableToMarkdown(block, ctx) {
  const rows = await ctx.blocksOf(block.id);
  const table_rows = rows.filter((row) => row.type === 'table_row');
  if (!table_rows.length) return '';

  const cells = table_rows.map((row) =>
    (row.table_row?.cells ?? []).map((cell) => richTextToMarkdown(cell).trim())
  );
  const columns = Math.max(...cells.map((row) => row.length));
  const width = Math.max(1, Number(block.table?.table_width) || columns);
  const normalized = cells.map((row) => {
    const copy = [...row];
    while (copy.length < width) copy.push('');
    return copy.slice(0, width);
  });

  const header = normalized[0];
  const body = normalized.slice(1);
  const line = (row) => `| ${row.map(escapeTableCell).join(' | ')} |`;
  const separator = `| ${header.map(() => '---').join(' | ')} |`;
  return [line(header), separator, ...body.map(line)].join('\n');
}

/* ------------------------------------------------------------------ */
/* 图片下载                                                            */
/* ------------------------------------------------------------------ */

const IMAGE_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
};

export async function downloadImage(url, blockId, pageId) {
  if (flags.noImages) return url;
  const pageDir = pageId ? pageId.replace(/-/g, '').slice(0, 8) : 'shared';
  // 按 URL 的 pathname 做哈希：Notion 签名 URL 的 query（X-Amz-Signature 等）每次都会变，
  // 只用 pathname 才能让同名图片在多次同步之间保持稳定、避免重复下载。
  const stableKey = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  })();
  const hash = crypto.createHash('sha1').update(stableKey).digest('hex').slice(0, 12);

  // 已按内容哈希落盘则直接复用（ASSET_DIR 可被测试覆盖）
  const existing = await findExisting(path.join(ASSET_DIR, pageDir), hash);
  if (existing) return `/notion-assets/${pageDir}/${existing}`;

  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(90_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim();
    const ext =
      IMAGE_EXT[contentType] ||
      extFromUrl(url) ||
      (contentType.startsWith('image/') ? 'png' : '');
    if (!ext) throw new Error(`无法识别的图片类型：${contentType}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const filename = `${hash}.${ext}`;
    const dir = path.join(ASSET_DIR, pageDir);
    if (!flags.dryRun) {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, filename), buffer);
    }
    log.detail(`下载图片 ${filename} (${(buffer.length / 1024).toFixed(0)} KB)`);
    return `/notion-assets/${pageDir}/${filename}`;
  } catch (err) {
    log.warn(`图片下载失败，暂用原始链接：${err.message}`);
    return url;
  }
}

async function findExisting(dir, hash) {
  for (const ext of Object.values(IMAGE_EXT).filter((v, i, a) => a.indexOf(v) === i)) {
    const filename = `${hash}.${ext}`;
    if (await exists(path.join(dir, filename))) return filename;
  }
  return '';
}

function extFromUrl(url) {
  try {
    const { pathname } = new URL(url);
    const match = pathname.match(/\.(png|jpe?g|gif|webp|svg|avif)$/i);
    return match ? match[1].toLowerCase().replace('jpeg', 'jpg') : '';
  } catch {
    return '';
  }
}

async function downloadCover(url, pageId) {
  if (!url) return '';
  if (flags.noImages) return url;
  return downloadImage(url, 'cover', pageId);
}

/* ------------------------------------------------------------------ */
/* 页面元数据 → frontmatter                                            */
/* ------------------------------------------------------------------ */

function findProperty(properties = {}, type) {
  return Object.entries(properties).find(([, prop]) => prop?.type === type);
}

function propPlain(prop) {
  if (!prop) return '';
  switch (prop.type) {
    case 'title':
      return plainText(prop.title);
    case 'rich_text':
      return plainText(prop.rich_text);
    case 'select':
      return prop.select?.name ?? '';
    case 'multi_select':
      return prop.multi_select?.map((item) => item.name).join(', ') ?? '';
    case 'date':
      return prop.date?.start ?? '';
    case 'formula':
      return prop.formula?.string ?? String(prop.formula?.number ?? prop.formula?.boolean ?? '');
    default:
      return '';
  }
}

function pickNamedProperty(properties, envName, type, matcher) {
  if (envName && properties[envName]) return propPlain(properties[envName]);
  const match = Object.entries(properties).find(
    ([name, prop]) => prop?.type === type && (!matcher || matcher(name))
  );
  return match ? propPlain(match[1]) : '';
}

function slugify(input = '') {
  const slug = input
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .replace(/['"“”‘’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || 'untitled';
}

function formatDateOnly(dateLike) {
  if (!dateLike) return '';
  // 优先保留原始日期部分，避免时区转换导致日期偏移
  const rawMatch = String(dateLike).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (rawMatch) return `${rawMatch[1]}-${rawMatch[2]}-${rawMatch[3]}`;
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function yamlString(value) {
  return JSON.stringify(value ?? '');
}

function yamlArray(values = []) {
  return `[${values.map((v) => yamlString(v)).join(', ')}]`;
}

/** 去掉 AI 助手标记、与页面标题重复的一级标题、并压缩空行 */
export function cleanMarkdownBody(markdown = '', title = '') {
  const normalize = (value = '') =>
    value
      .replace(/^#+\s*/, '')
      .replace(/[^\p{L}\p{N}]/gu, '')
      .toLowerCase();
  const target = normalize(title);

  let lines = markdown.replace(/\r\n/g, '\n').split('\n');
  lines = lines.filter((line) => !/^\s*#{1,6}\s*(?:🤖\s*)?Assistant\s*$/i.test(line));
  lines = lines.filter((line) => !/^\s*(?:🤖\s*)?Assistant\s*$/i.test(line));

  const headingIndex = lines.findIndex((line) => /^#\s+/.test(line.trim()));
  if (headingIndex !== -1 && target && normalize(lines[headingIndex]) === target) {
    lines.splice(headingIndex, 1);
  }

  // 去掉开头和结尾的空行
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function excerptFromMarkdown(markdown, length = 140) {
  const text = markdown
    // 摘要里不要混入标题文字（Notion 文稿常常标题+正文重复）
    .replace(/^#{1,6}\s+.*$/gm, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|=-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, length) + (text.length > length ? '…' : '');
}

/* ------------------------------------------------------------------ */
/* 收集 Notion 内容                                                     */
/* ------------------------------------------------------------------ */

export function cleanNotionId(input = '') {
  const text = String(input || '').trim();
  // 支持完整 URL / 带连字符 id / 纯 32 位 hex
  const compact = text.replace(/-/g, '');
  const match = compact.match(/[0-9a-f]{32}/i);
  if (match) {
    const raw = match[0].toLowerCase();
    return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
  }
  if (/^https?:/i.test(text)) {
    const segment = text.split(/[/?#]/).filter(Boolean).pop() || '';
    return segment !== text ? cleanNotionId(segment) : '';
  }
  return text;
}

async function collectFromDatabase(databaseId, env) {
  let database;
  try {
    database = await notionRequest(`/databases/${databaseId}`);
  } catch (err) {
    // Notion 2025-09 之后新建的数据库可能要求新版 API
    if (err.status === 400) {
      database = await notionRequest(`/databases/${databaseId}`, { version: '2025-09-03' });
    } else {
      throw err;
    }
  }
  const dbTitle =
    plainText(database?.title) || database?.data_sources?.[0]?.name || 'Notion 数据库';
  log.info(`  数据库：${dbTitle}`);

  let rows;
  try {
    rows = await queryDatabaseAll(databaseId);
  } catch (err) {
    // 新版数据库（data source）需要走 /data_sources/:id/query
    const dataSourceId = database?.data_sources?.[0]?.id;
    if (err.status === 400 && dataSourceId) {
      log.warn('当前数据库使用新版 data source 结构，正在切换接口…');
      rows = await queryDataSourceAll(dataSourceId);
    } else if (err.status === 404 && database?.data_sources?.[0]?.id) {
      rows = await queryDataSourceAll(database.data_sources[0].id);
    } else {
      throw err;
    }
  }
  log.info(`  共 ${rows.length} 条页面记录`);

  const items = [];
  for (const page of rows) {
    const properties = page.properties ?? {};
    const title =
      pickNamedProperty(properties, env.NOTION_TITLE_PROP, 'title') || '未命名页面';
    const date =
      pickNamedProperty(properties, env.NOTION_DATE_PROP, 'date') ||
      page.last_edited_time;
    const tagsRaw =
      env.NOTION_TAGS_PROP && properties[env.NOTION_TAGS_PROP]
        ? propPlain(properties[env.NOTION_TAGS_PROP])
        : findProperty(properties, 'multi_select')?.[1]?.multi_select?.map((i) => i.name) ?? [];
    const tags = Array.isArray(tagsRaw)
      ? tagsRaw
      : tagsRaw
          .split(/[,，]/)
          .map((t) => t.trim())
          .filter(Boolean);

    let category = '';
    if (env.NOTION_CATEGORY_PROP && properties[env.NOTION_CATEGORY_PROP]) {
      category = propPlain(properties[env.NOTION_CATEGORY_PROP]);
    } else {
      const selectEntry = Object.entries(properties).find(
        ([name, prop]) => prop?.type === 'select' && !['状态', 'Status'].includes(name)
      );
      category = selectEntry ? propPlain(selectEntry[1]) : '';
    }

    const description =
      pickNamedProperty(
        properties,
        env.NOTION_DESCRIPTION_PROP,
        'rich_text',
        (name) => /摘要|简介|描述|总结|description|summary|excerpt/i.test(name)
      ) || '';

    let draft = false;
    if (env.NOTION_DRAFT_PROP && properties[env.NOTION_DRAFT_PROP]) {
      draft = Boolean(propPlain(properties[env.NOTION_DRAFT_PROP]));
    } else {
      const checkbox = Object.entries(properties).find(
        ([name, prop]) => prop?.type === 'checkbox' && /草稿|draft/i.test(name)
      );
      draft = Boolean(checkbox?.[1]?.checkbox);
    }

    items.push({
      id: page.id,
      title,
      date,
      updated: page.last_edited_time,
      tags,
      category,
      description,
      draft,
      cover: page.cover,
      icon: page.icon,
      blocks: () => collectPageBlocks(page.id),
    });
  }
  return items;
}

async function collectFromPageTree(rootPageId, env) {
  const root = await notionRequest(`/pages/${rootPageId}`);
  const rootTitle = plainText(root.properties?.title?.title) || plainText(root.properties?.Name?.title) || 'Notion 页面树';
  log.info(`  页面：${rootTitle}`);

  const blocks = await collectPageBlocks(rootPageId);
  const childPages = blocks.filter((block) => block.type === 'child_page');

  if (!childPages.length) {
    // 根页面本身就是一篇文章
    return [
      {
        id: root.id,
        title: rootTitle,
        date: root.last_edited_time,
        updated: root.last_edited_time,
        tags: [],
        category: '',
        description: '',
        draft: false,
        cover: root.cover,
        icon: root.icon,
        blocks: async () => blocks,
      },
    ];
  }

  const items = [];
  for (const child of childPages) {
    const page = await notionRequest(`/pages/${child.id}`);
    const title = child.child_page?.title || plainText(page.properties?.title?.title) || '未命名页面';
    items.push({
      id: page.id,
      title,
      date: page.last_edited_time,
      updated: page.last_edited_time,
      tags: [],
      category: '',
      description: '',
      draft: false,
      cover: page.cover,
      icon: page.icon,
      blocks: () => collectPageBlocks(page.id, 1),
    });
  }
  return items;
}

async function collectPageBlocks(pageId, depth = 0) {
  const blocks = await listAllChildren(pageId);
  if (depth >= 2) {
    // 深层子页面只保留标题，避免无限递归
    return blocks.map((block) =>
      block.type === 'child_page' ? { ...block, has_children: false } : block
    );
  }
  return blocks;
}

/* ------------------------------------------------------------------ */
/* 写出文件                                                            */
/* ------------------------------------------------------------------ */

function buildMarkdown(post, markdown) {
  const date = formatDateOnly(post.date);
  const lines = ['---'];
  lines.push(`title: ${yamlString(post.title)}`);
  lines.push(`description: ${yamlString(post.description || excerptFromMarkdown(markdown))}`);
  if (date) lines.push(`date: ${date}`);
  if (post.updated) lines.push(`updated: ${new Date(post.updated).toISOString()}`);
  if (post.tags?.length) lines.push(`tags: ${yamlArray(post.tags)}`);
  if (post.category) lines.push(`category: ${yamlString(post.category)}`);
  if (post.coverPath) lines.push(`cover: ${yamlString(post.coverPath)}`);
  if (post.draft) lines.push('draft: true');
  lines.push(`notionId: ${yamlString(post.id)}`);
  lines.push(`notionUrl: ${yamlString(pageUrl(post.id))}`);
  lines.push('source: "notion"');
  lines.push('---');
  lines.push('');
  lines.push(markdown.trim());
  lines.push('');
  return lines.join('\n');
}

async function readManifest() {
  try {
    const raw = await fs.readFile(MANIFEST_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { version: 1, pages: {}, files: [] };
  }
}

async function writeManifest(manifest) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

async function main() {
  const started = Date.now();
  const env = loadEnv();
  API = env.NOTION_API_BASE || API;
  token = requireEnv(
    env,
    'NOTION_TOKEN',
    '在 https://www.notion.so/my-integrations 创建 integration 并复制 token。'
  );

  if (flags.print) {
    flags.noImages = true;
    const printId = cleanNotionId(flags.print);
    log.info(`◉ 预览页面转换结果：${printId}`);
    const blocks = await listAllChildren(printId);
    const markdown = await blocksToMarkdown(blocks, {
      pageId: printId,
      depth: 0,
      blocksOf: listAllChildren,
      downloadImage: async (url) => url,
    });
    console.log(`\n${markdown}\n`);
    return;
  }

  const dbId = env.NOTION_DATABASE_ID ? cleanNotionId(env.NOTION_DATABASE_ID) : '';
  const pageId = env.NOTION_PAGE_ID ? cleanNotionId(env.NOTION_PAGE_ID) : '';
  if (!dbId && !pageId) {
    throw new Error('请至少配置 NOTION_DATABASE_ID 或 NOTION_PAGE_ID（见 .env.example）。');
  }

  log.info('◉ 正在读取 Notion 内容…');

  let items = [];
  let mode = '';
  if (dbId) {
    try {
      items = await collectFromDatabase(dbId, env);
      mode = 'database';
    } catch (err) {
      if (err.status === 404 && pageId) {
        log.warn('NOTION_DATABASE_ID 不是数据库，改用页面树模式。');
        items = await collectFromPageTree(pageId, env);
        mode = 'page';
      } else if (err.status === 404) {
        throw new Error(
          '找不到该数据库：请确认 ID 正确，且在 Notion 页面右上角 ··· → 连接 中已添加你的 integration。'
        );
      } else {
        throw err;
      }
    }
  } else {
    items = await collectFromPageTree(pageId, env);
    mode = 'page';
  }

  if (flags.limit) items = items.slice(0, flags.limit);

  // 白名单：只同步标题包含这些关键词的页面（用于「只公开理论研究/进展/课程」）
  const includeKeys = (env.NOTION_INCLUDE_TITLES || '')
    .split(/[,，]/)
    .map((key) => key.trim())
    .filter(Boolean);
  if (includeKeys.length) {
    const before = items.length;
    items = items.filter((item) => includeKeys.some((key) => item.title.includes(key)));
    log.info(
      `  仅保留标题含「${includeKeys.join(' / ')}」的页面：${items.length} 篇（排除 ${before - items.length} 篇）`
    );
  }

  // 黑名单：按标题关键词排除页面（例如内部的合同、报价、台账、营销方案）
  const excludeKeys = (env.NOTION_EXCLUDE_TITLES || '')
    .split(/[,，]/)
    .map((key) => key.trim())
    .filter(Boolean);
  if (excludeKeys.length) {
    const before = items.length;
    items = items.filter(
      (item) =>
        !excludeKeys.some((key) =>
          // 以 = 开头表示精确匹配标题，否则按包含匹配
          key.startsWith('=') ? item.title === key.slice(1) : item.title.includes(key)
        )
    );
    if (before !== items.length) {
      log.info(`  按 NOTION_EXCLUDE_TITLES 排除了 ${before - items.length} 篇`);
    }
  }
  if (!items.length) {
    log.warn('没有读取到任何页面。请确认 integration 已被授权访问该页面/数据库。');
  }

  const manifest = await readManifest();
  const nextPages = {};
  const usedFilenames = new Set();
  const stats = { created: 0, updated: 0, skipped: 0, deleted: 0, images: 0 };
  const written = [];
  let previewPool = [];

  await fs.mkdir(CONTENT_DIR, { recursive: true });

  for (const [index, item] of items.entries()) {
    const label = `[${index + 1}/${items.length}] ${item.title}`;
    const previous = manifest.pages[item.id];
    const fileExists = previous
      ? await exists(path.join(CONTENT_DIR, previous.file))
      : false;
    const imagesExist =
      previous && previous.images?.length
        ? (
            await Promise.all(
              previous.images.map((img) =>
                exists(path.join(ROOT, 'public', img.replace(/^\//, '')))
              )
            )
          ).every(Boolean)
        : true;

    if (!flags.force && previous && previous.lastEditedTime === item.updated && fileExists && imagesExist) {
      log.detail(`${label} → 无变化，跳过`);
      nextPages[item.id] = previous;
      usedFilenames.add(previous.file);
      stats.skipped++;
      continue;
    }

    const blocks = await item.blocks();
    const collectedImages = [];
    const ctx = {
      pageId: item.id,
      depth: 0,
      blocksOf: (blockId) => listAllChildren(blockId),
      downloadImage: async (url, blockId, pageId) => {
        const result = await downloadImage(url, blockId, pageId);
        if (result.startsWith('/notion-assets/')) collectedImages.push(result);
        return result;
      },
    };
    const rawMarkdown = await blocksToMarkdown(blocks, ctx);
    const markdown = cleanMarkdownBody(rawMarkdown, item.title);

    if (item.cover) {
      const coverUrl =
        item.cover.type === 'external' ? item.cover.external?.url : item.cover.file?.url;
      item.coverPath = await downloadCover(coverUrl, item.id);
      if (item.coverPath.startsWith('/notion-assets/')) collectedImages.push(item.coverPath);
    }

    const filename = await uniqueFilename(item, usedFilenames);
    const file = buildMarkdown(item, markdown || `*（这一页还没有内容）*`);

    if (flags.dryRun) {
      written.push({ filename, title: item.title, size: file.length });
      log.info(`${label} → 将写入 ${filename}（${file.length} 字符）`);
    } else {
      await fs.writeFile(path.join(CONTENT_DIR, filename), file, 'utf8');
      written.push({ filename, title: item.title, size: file.length });
      log.info(`${label} → ${filename}`);
    }

    stats[previous ? 'updated' : 'created']++;
    stats.images += collectedImages.length;
    nextPages[item.id] = {
      file: filename,
      title: item.title,
      lastEditedTime: item.updated,
      images: collectedImages,
      updatedAt: new Date().toISOString(),
    };
    usedFilenames.add(filename);
  }

  // 清理已经从 Notion 删除的页面
  const staleFiles = (manifest.files || []).filter(
    (file) => !usedFilenames.has(file) && !isManualPost(file)
  );
  for (const file of staleFiles) {
    const full = path.join(CONTENT_DIR, file);
    if (await exists(full)) {
      if (!flags.dryRun) await fs.rm(full, { force: true });
      log.info(`  删除已移除的页面：${file}`);
      stats.deleted++;
    }
  }

  if (!flags.dryRun) {
    const removed = await pruneAssets(nextPages);
    if (removed) log.info(`  清理了 ${removed} 个不再被引用的旧图片`);
    await writeManifest({
      version: 1,
      mode,
      root: dbId || pageId,
      syncedAt: new Date().toISOString(),
      pages: nextPages,
      files: [...usedFilenames].filter((f) => !f.startsWith('demo-')),
    });
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  log.info('');
  log.info(
    `✓ 同步完成（${seconds}s）：新增 ${stats.created}，更新 ${stats.updated}，跳过 ${stats.skipped}，删除 ${stats.deleted}，图片 ${stats.images}`
  );
  if (flags.dryRun) log.info('  （dry-run：未写入任何文件）');
}

function isManualPost(filename) {
  // 手写文章命名以 demo- 开头，或不在 manifest 中时不会被误删
  return filename.startsWith('demo-');
}

async function uniqueFilename(item, used) {
  const date = formatDateOnly(item.date);
  const base = slugify(item.title);
  let name = `${date ? `${date}-` : ''}${base}.md`;
  let counter = 2;
  while (used.has(name)) {
    name = `${date ? `${date}-` : ''}${base}-${counter}.md`;
    counter++;
  }
  return name;
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/** 删除 public/notion-assets 下不再被任何页面引用的旧图片（Notion 签名 URL 变化会产生孤儿文件） */
async function pruneAssets(pages) {
  const referenced = new Set();
  for (const entry of Object.values(pages)) {
    for (const image of entry.images ?? []) {
      // 清单里存的是站内 URL（/notion-assets/...），按 ASSET_DIR 还原成相对仓库根的真实路径
      const relativeAsset = String(image).replace(/^\/notion-assets\//, '');
      const relativePath = path.relative(ROOT, path.join(ASSET_DIR, relativeAsset));
      referenced.add(relativePath.split(path.sep).join('/'));
    }
  }

  let removed = 0;
  const emptyDirs = [];
  const walk = async (dir) => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        emptyDirs.push(full);
      } else {
        const relative = path.relative(ROOT, full).split(path.sep).join('/');
        if (!referenced.has(relative)) {
          if (!flags.dryRun) await fs.rm(full, { force: true });
          removed++;
        }
      }
    }
  };
  await walk(ASSET_DIR);

  // 顺带清理空目录
  for (const dir of emptyDirs.reverse()) {
    try {
      const left = await fs.readdir(dir);
      if (!left.length) await fs.rmdir(dir);
    } catch {
      /* ignore */
    }
  }
  return removed;
}

/* ------------------------------------------------------------------ */
/* 入口                                                                */
/* ------------------------------------------------------------------ */

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  main().catch((err) => {
    log.error(err.message);
    if (flags.verbose) console.error(err);
    process.exitCode = 1;
  });
}
