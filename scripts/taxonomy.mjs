/**
 * 标题 → 系列 / 分类 / 标签 / 研究阶段 的轻量规则。
 * Notion 页面树模式没有属性，用标题规律把书稿、论文与碎片归类。
 */

const STAGE_BOOK = '书稿（修订中）';
const STAGE_PAPER = '工作论文';
const STAGE_NOTE = '研究笔记';

export function classifyTitle(title = '') {
  const t = String(title).trim();

  if (/^《任务型社会/.test(t)) {
    return { category: '任务型社会（书稿）', tags: ['书稿', '任务型社会'], stage: STAGE_BOOK };
  }
  if (/^（重构）|^\(重构\)/.test(t)) {
    return { category: '功能导向（重构版）', tags: ['书稿', '功能导向', '平台用工'], stage: STAGE_BOOK };
  }
  if (/^《功能导向/.test(t)) {
    return { category: '功能导向（重构版）', tags: ['书稿', '功能导向', '平台用工'], stage: STAGE_BOOK };
  }
  if (/^《系统的代价》/.test(t)) {
    return { category: '系统的代价', tags: ['书稿', '系统的代价'], stage: STAGE_BOOK };
  }
  if (/^第[一二三四五六七八九十百]+阶段|^十五个阶段|^第[一二三四五六七八九十]+阶段/.test(t)) {
    return { category: '十五个阶段', tags: ['书稿', '十五个阶段'], stage: STAGE_BOOK };
  }
  if (/^第[一二三四五六七八九十百]+章|^第\d+章|^导言$/.test(t)) {
    return { category: '功能导向（初版）', tags: ['书稿', '功能导向', '平台用工'], stage: STAGE_BOOK };
  }
  if (/技能资产|岗位价值|个人价值/.test(t)) {
    return { category: '理论文章', tags: ['文章', '技能资产'], stage: STAGE_PAPER };
  }
  if (/任务型劳动关系|任务型生产关系|任务型社会|交易成本|科层制|裂变|核心洞见/.test(t)) {
    return { category: '理论文章', tags: ['文章', '任务型劳动关系'], stage: STAGE_PAPER };
  }
  if (/缘起性空|因缘性空|高维|造物者|凝视深渊|系统的代价/.test(t)) {
    return { category: '思想笔记', tags: ['思想笔记'], stage: STAGE_NOTE };
  }
  return { category: '其他文稿', tags: ['文稿'], stage: STAGE_NOTE };
}
