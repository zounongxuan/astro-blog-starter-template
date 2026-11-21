#!/usr/bin/env node
/**
 * 当 `git push` 因网络问题失败时的兜底推送方案：走 GitHub Git Data API。
 *
 * 用法：
 *   $env:GITHUB_TOKEN="github_pat_xxx"; npm run push:api
 *   # 或在 .env 里配置 GITHUB_TOKEN
 *
 * 它会：
 *   1. 读取本地 HEAD 的完整文件树（git ls-tree）
 *   2. 通过 API 逐个上传 blob，创建 tree / commit（父提交 = 远端当前 main）
 *   3. 更新远端 main 分支（force，但保留远端历史）
 *
 * 说明：API 通道（api.github.com）通常比 git 通道（github.com:443）稳定得多；
 * 如果 git push 报 408 / connection reset，用这个脚本即可。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRANCH = process.argv.includes('--branch')
  ? process.argv[process.argv.indexOf('--branch') + 1]
  : 'main';

/* ---------- 读取 .env 与 token ---------- */
function loadEnv() {
  const env = { ...process.env };
  try {
    const raw = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (process.env[key] === undefined) env[key] = value;
    }
  } catch {
    /* ignore */
  }
  return env;
}

const env = loadEnv();
const token = env.GITHUB_TOKEN || env.GH_TOKEN;
if (!token) {
  console.error('✖ 缺少 GITHUB_TOKEN。请在 .env 中添加 GITHUB_TOKEN=github_pat_xxx（需 Contents 读写 + Workflows 读写的 fine-grained token）。');
  process.exit(1);
}

function git(args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} 失败：${(result.stderr || '').trim()}`);
  }
  return result.stdout.trim();
}

/* ---------- 解析仓库地址 ---------- */
const remoteUrl = git(['remote', 'get-url', 'origin']).replace(/\.git$/, '');
const repoMatch = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/]+)$/);
if (!repoMatch) {
  console.error(`✖ 无法从远程地址解析 owner/repo：${remoteUrl}`);
  process.exit(1);
}
const [, owner, repoName] = repoMatch;
const REPO = `${owner}/${repoName}`;

const H = {
  Authorization: `Bearer ${token}`,
  'User-Agent': 'dsh-notion-garden',
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json',
};

async function api(pathname, init = {}) {
  const res = await fetch(`https://api.github.com${pathname}`, { ...init, headers: H });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(`${init.method ?? 'GET'} ${pathname} -> ${res.status}: ${text.slice(0, 400)}\n` +
      (res.status === 403 ? '  提示：确认 token 具备 Contents: Read and write（以及 Workflows: Read and write，仓库里有 .github/workflows）。' : ''));
  }
  return body;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) {
        const i = index++;
        results[i] = await fn(items[i], i);
      }
    })
  );
  return results;
}

async function main() {
  const head = git(['rev-parse', 'HEAD']).slice(0, 7);
  const message = git(['log', '-1', '--format=%B']);
  const remoteMain = (await api(`/repos/${REPO}/git/ref/heads/${BRANCH}`)).object.sha;
  console.log(`仓库：${REPO} | 分支：${BRANCH} | 远端：${remoteMain.slice(0, 7)} | 本地：${head}`);

  const lines = git(['ls-tree', '-r', '--full-tree', 'HEAD']).split(/\r?\n/).filter(Boolean);
  console.log(`本地文件数：${lines.length}`);

  let done = 0;
  const entries = await mapLimit(
    lines.map((line) => {
      const tab = line.indexOf('\t');
      const [mode, type] = line.slice(0, tab).split(' ');
      return { mode, type, file: line.slice(tab + 1) };
    }),
    5,
    async (item) => {
      const content = fs.readFileSync(path.join(ROOT, item.file));
      const blob = await api(`/repos/${REPO}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({ content: content.toString('base64'), encoding: 'base64' }),
      });
      done++;
      if (done % 10 === 0) console.log(`  已上传 ${done}/${lines.length}`);
      return { path: item.file, mode: item.mode, type: 'blob', sha: blob.sha };
    }
  );

  const tree = await api(`/repos/${REPO}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ tree: entries }),
  });
  const commit = await api(`/repos/${REPO}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message, tree: tree.sha, parents: [remoteMain] }),
  });
  await api(`/repos/${REPO}/git/refs/heads/${BRANCH}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha, force: true }),
  });

  console.log(`✓ 已通过 API 推送：${commit.sha.slice(0, 7)}（${message.split('\n')[0]}）`);
  console.log(`  https://github.com/${REPO}/commit/${commit.sha}`);
  console.log('  GitHub Actions 将自动构建并部署。');
}

main().catch((err) => {
  console.error('✖', err.message);
  process.exit(1);
});
