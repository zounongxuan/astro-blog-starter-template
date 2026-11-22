/**
 * 用本地 mock 的 Notion API 跑一遍真实同步流程，验证：
 * - 数据库查询 / 页面 / blocks 分页
 * - 富文本与各种 block 的 Markdown 转换
 * - 图片与封面下载
 * - frontmatter、草稿标记、manifest 清单
 *
 * 产物写到 .notion-cache/test/ 隔离目录，测试结束自动清理，不污染正式内容。
 * 运行：npm run test:sync
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fixtures from './fixtures.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const TEST_DIR = path.join(ROOT, '.notion-cache', 'test');
const CONTENT_DIR = path.join(TEST_DIR, 'content');
const ASSET_DIR = path.join(TEST_DIR, 'assets');
const MANIFEST_PATH = path.join(TEST_DIR, 'cache', 'sync-manifest.json');

const svg = (label, color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="${color}"/><text x="320" y="190" font-family="Georgia, serif" font-size="34" fill="#FBFAF7" text-anchor="middle">${label}</text></svg>`;

let server;
let base = '';

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(data) });
  res.end(data);
}

/** 把 fixture 里的 __BASE__ 替换为 mock server 地址 */
function withBase(value) {
  return JSON.parse(JSON.stringify(value).replaceAll('__BASE__', base));
}

function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const segments = url.pathname.split('/').filter(Boolean); // ['v1','blocks',id,'children']

    if (url.pathname.startsWith('/img/')) {
      const name = url.pathname.replace('/img/', '').replace(/\.svg$/, '');
      const body = svg(name, name.includes('cover') ? '#B4451F' : '#57534C');
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'content-length': Buffer.byteLength(body) });
      res.end(body);
      return;
    }

    if (segments[0] !== 'v1') {
      json(res, 404, { object: 'error', message: 'not found' });
      return;
    }

    // GET /v1/databases/:id
    if (segments[1] === 'databases' && segments[3] === undefined && req.method === 'GET') {
      json(res, 200, withBase(fixtures.database));
      return;
    }

    // POST /v1/databases/:id/query
    if (segments[1] === 'databases' && segments[3] === 'query' && req.method === 'POST') {
      const results = fixtures.rows.map((row) => withBase(row));
      json(res, 200, { object: 'list', results, has_more: false, next_cursor: null });
      return;
    }

    // GET /v1/pages/:id
    if (segments[1] === 'pages' && segments[2] && req.method === 'GET') {
      const row = fixtures.rows.find((r) => r.id === segments[2]);
      if (!row) {
        json(res, 404, { object: 'error', message: 'page not found' });
        return;
      }
      json(res, 200, withBase(row));
      return;
    }

    // GET /v1/blocks/:id/children
    if (segments[1] === 'blocks' && segments[2] && segments[3] === 'children' && req.method === 'GET') {
      const children = fixtures.blocks[segments[2]] ?? [];
      json(res, 200, {
        object: 'list',
        results: withBase(children),
        has_more: false,
        next_cursor: null,
      });
      return;
    }

    json(res, 404, { object: 'error', message: `unhandled ${req.method} ${url.pathname}` });
  });
}

function runSync(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'notion-sync.mjs'), '--force', '--verbose'], {
      cwd: ROOT,
      env,
      stdio: 'inherit',
      shell: false,
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

function assert(condition, message, failures) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    console.log(`  ✗ ${message}`);
    failures.push(message);
  }
}

async function readPostByTitle(titleFragment) {
  const files = await fs.readdir(CONTENT_DIR).catch(() => []);
  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const content = await fs.readFile(path.join(CONTENT_DIR, file), 'utf8');
    if (content.includes(titleFragment)) return { file, content };
  }
  return null;
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  console.log(`\n▶ mock Notion API: ${base}`);
  console.log('▶ 运行同步脚本…\n');

  const env = {
    ...process.env,
    NOTION_TOKEN: 'mock-token',
    NOTION_API_BASE: `${base}/v1`,
    NOTION_DATABASE_ID: fixtures.DATABASE_ID,
    NOTION_CONTENT_DIR: '.notion-cache/test/content',
    NOTION_ASSET_DIR: '.notion-cache/test/assets',
    NOTION_CACHE_DIR: '.notion-cache/test/cache',
    NOTION_DOWNLOAD_IMAGES: 'true',
  };
  delete env.NOTION_PAGE_ID;

  let code;
  try {
    code = await runSync(env);
  } finally {
    server.close();
  }

  if (code !== 0) {
    console.error(`\n✖ 同步脚本退出码 ${code}`);
    await cleanup();
    process.exit(1);
  }

  console.log('\n▶ 校验产物…');
  const failures = [];

  const mainPost = await readPostByTitle('Notion 转换全元素覆盖');
  assert(Boolean(mainPost), '主测试文章已生成', failures);
  assert(Boolean(mainPost?.file.match(/^2025-11-20-.*\.md$/)), `文件名带日期前缀（${mainPost?.file}）`, failures);

  const md = mainPost?.content ?? '';
  const checks = [
    ['> 💡 这是一条 callout 提示', 'callout → 引用块'],
    ['<strong>加粗</strong>', '加粗'],
    ['<em>斜体</em>', '斜体'],
    ['<del>删除线</del>', '删除线'],
    ['`行内代码`', '行内代码'],
    ['[链接](https://example.com)', '外部链接'],
    ['$E = mc^2$', '行内公式'],
    ['## 二级标题', '标题'],
    ['#### 四级标题', '四级标题'],
    ['- 第一层列表项', '无序列表'],
    ['  - 嵌套的第一项', '嵌套列表缩进'],
    ['- [x] 已完成的任务', '已完成待办'],
    ['- [ ] 未完成的任务', '未完成待办'],
    ['<details>', '折叠块'],
    ['> 这是一段引用文字。', '引用'],
    ['```js', '代码块语言'],
    ['const answer = 42;', '代码内容'],
    ['$$\nP(H \\mid E)', '独立公式块'],
    ['![一张示例图片](/notion-assets/', '图片下载为本地路径'],
    ['[Notion 官网](https://www.notion.so)', '书签'],
    ['| 列 A | 列 B |', '表格表头'],
    ['| 值 1 | 值 \\| 含竖线 |', '表格竖线转义'],
    ['#### 附录：子页面内容', '子页面标题'],
    ['这是子页面里的正文内容。', '子页面正文'],
    ['category: "理论"', '分类 frontmatter'],
    ['tags: ["测试", "转换"]', '标签 frontmatter'],
    ['source: "notion"', '来源 frontmatter'],
  ];
  for (const [needle, label] of checks) {
    assert(md.includes(needle), label, failures);
  }

  const coverLine = md.match(/cover: "(\/notion-assets\/[^"]+)"/);
  assert(Boolean(coverLine), '封面写入 frontmatter', failures);
  if (coverLine) {
    const coverPath = path.join(ASSET_DIR, coverLine[1].replace(/^\/notion-assets\//, ''));
    assert(await exists(coverPath), `封面文件存在（${coverLine[1]}）`, failures);
  }

  const imageLine = md.match(/!\[一张示例图片\]\((\/notion-assets\/[^)]+)\)/);
  if (imageLine) {
    const imagePath = path.join(ASSET_DIR, imageLine[1].replace(/^\/notion-assets\//, ''));
    assert(await exists(imagePath), `正文图片文件存在（${imageLine[1]}）`, failures);
  }

  const draftPost = await readPostByTitle('不应该出现在网站上');
  assert(Boolean(draftPost?.content.includes('draft: true')), '草稿页面标记 draft: true', failures);

  const manifestRaw = await fs.readFile(MANIFEST_PATH, 'utf8').catch(() => '');
  const manifest = manifestRaw ? JSON.parse(manifestRaw) : { pages: {} };
  assert(Object.keys(manifest.pages ?? {}).length >= 3, 'manifest 记录了同步页面', failures);

  console.log(failures.length ? `\n✖ 失败 ${failures.length} 项` : '\n✓ 全部通过');
  await cleanup();
  process.exit(failures.length ? 1 : 0);
}

async function cleanup() {
  await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
}

main().catch(async (err) => {
  console.error(err);
  server?.close();
  await cleanup();
  process.exit(1);
});
