#!/usr/bin/env node
/**
 * 一键发布：Notion 同步 → 构建校验 → git 提交 → 推送
 * GitHub Actions 收到推送后会自动构建并发布到 GitHub Pages。
 *
 * 用法：
 *   node scripts/publish.mjs                 # 同步 + 构建 + 提交推送
 *   node scripts/publish.mjs --no-sync       # 跳过 Notion 同步
 *   node scripts/publish.mjs --no-build      # 跳过本地构建校验（更快，风险更高）
 *   node scripts/publish.mjs --dry-run       # 只显示将要执行的动作
 *   node scripts/publish.mjs --message "..." # 自定义提交信息
 *
 * 注意：为了在所有环境（包括受限沙箱）下可用，这里不使用管道捕获子进程输出。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);
const has = (name) => argv.includes(name);
function flagValue(name) {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

const skipSync = has('--no-sync');
const skipBuild = has('--no-build');
const dryRun = has('--dry-run');
const customMessage = flagValue('--message');

const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';

function run(command, args, label, { allowFail = false } = {}) {
  console.log(`\n▶ ${label}`);
  if (dryRun) {
    console.log(`  [dry-run] ${command} ${args.join(' ')}`);
    return 0;
  }
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: isWindows && /\.cmd$/i.test(command),
  });
  const code = result.status ?? 1;
  if (code !== 0 && !allowFail) {
    console.error(`\n✖ ${label} 失败（退出码 ${code}）`);
    process.exit(code);
  }
  return code;
}

/* 1. 前置检查：是否已配置 git 远程仓库 -------------------------------- */
const hasRemote = run('git', ['remote', 'get-url', 'origin'], '检查远程仓库', { allowFail: true }) === 0;
if (!hasRemote) {
  console.error(
    '✖ 还没有配置远程仓库 origin。先执行（把地址换成你的仓库）：\n' +
      '  git remote add origin https://github.com/<用户名>/<仓库名>.git\n' +
      '  然后重新运行 npm run publish'
  );
  process.exit(1);
}

/* 2. 从 Notion 同步 --------------------------------------------------- */
if (skipSync) {
  console.log('\n↷ 已跳过 Notion 同步（--no-sync）');
} else {
  run(process.execPath, ['scripts/notion-sync.mjs'], '从 Notion 同步内容到 Markdown');
}

/* 3. 本地构建校验 ----------------------------------------------------- */
if (skipBuild) {
  console.log('\n↷ 已跳过本地构建校验（--no-build）');
} else {
  run(npm, ['run', 'build'], '本地构建校验（发现语法/依赖问题会在这里报错）');
}

/* 4. 提交 ------------------------------------------------------------- */
console.log('\n▶ 暂存变更');
run('git', ['add', '-A'], '暂存变更');

const staged = run('git', ['diff', '--cached', '--quiet'], '检查是否有变更', { allowFail: true });
if (staged === 0) {
  console.log('\n✓ 没有内容变化，无需提交。');
  process.exit(0);
}

const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
const message = customMessage || `content: sync from Notion (${stamp})`;
run('git', ['commit', '-m', message], '创建提交');

/* 5. 推送 ------------------------------------------------------------- */
run('git', ['push', '-u', 'origin', 'HEAD'], '推送到 origin');

console.log('\n✓ 已推送。GitHub Actions 将自动构建并部署。');
console.log('  打开仓库 → Actions 标签页可查看进度；完成后站点会更新。');
