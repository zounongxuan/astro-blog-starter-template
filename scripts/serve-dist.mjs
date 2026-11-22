#!/usr/bin/env node
/**
 * 零依赖静态文件服务器，用于预览构建产物 dist/。
 * 用法：npm run serve:dist [-- --port 4322]
 * 特点：支持目录 → index.html、404 → 404.html、正确 MIME、禁用缓存。
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const argv = process.argv.slice(2);
const portArg = argv.indexOf('--port');
const port = portArg !== -1 ? Number(argv[portArg + 1]) : 4322;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

async function statSafe(file) {
  try {
    return await fs.stat(file);
  } catch {
    return null;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';

  const candidate = path.join(ROOT, pathname);
  if (!candidate.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  let file = candidate;
  let stat = await statSafe(file);
  if (!stat && !path.extname(file)) {
    file = `${candidate}/index.html`;
    stat = await statSafe(file);
  }
  if (!stat || !stat.isFile()) {
    const notFound = path.join(ROOT, '404.html');
    const fallback = await statSafe(notFound);
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(fallback ? await fs.readFile(notFound) : '404 Not Found');
    return;
  }

  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  res.end(await fs.readFile(file));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`▶ 预览 http://127.0.0.1:${port}  （目录：${ROOT}）`);
  console.log('  按 Ctrl+C 停止');
});
