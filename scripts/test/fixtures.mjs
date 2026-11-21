/**
 * 本地测试用的 Notion API 模拟数据。
 * 覆盖：数据库模式、页面属性、富文本注解、嵌套列表、待办、折叠、引用、
 * callout、代码、公式、分隔线、表格、图片、书签、子页面、草稿过滤。
 */

const rt = (content, annotations = {}, link = null) => ({
  type: 'text',
  text: { content, link: link ? { url: link } : null },
  annotations: {
    bold: false,
    italic: false,
    strikethrough: false,
    underline: false,
    code: false,
    color: 'default',
    ...annotations,
  },
  plain_text: content,
  href: link,
});

const eqRt = (expression) => ({
  type: 'equation',
  equation: { expression },
  annotations: { bold: false, italic: false, code: false, strikethrough: false, underline: false },
  plain_text: expression,
  href: null,
});

const block = (id, type, payload, hasChildren = false) => ({
  object: 'block',
  id,
  type,
  has_children: hasChildren,
  [type]: payload,
});

const page = (id, title, extraProps = {}, opts = {}) => ({
  object: 'page',
  id,
  created_time: '2025-11-01T08:00:00.000Z',
  last_edited_time: opts.lastEdited ?? '2025-11-20T10:30:00.000Z',
  cover: opts.cover ?? null,
  icon: null,
  properties: {
    title: {
      id: 'title',
      type: 'title',
      title: [rt(title)],
    },
    ...extraProps,
  },
});

const dateProp = (value) => ({ id: 'date', type: 'date', date: { start: value, end: null } });
const multiSelectProp = (names) => ({
  id: 'tags',
  type: 'multi_select',
  multi_select: names.map((name) => ({ id: name, name, color: 'default' })),
});
const selectProp = (name) => ({
  id: 'category',
  type: 'select',
  select: { id: name, name, color: 'default' },
});
const richTextProp = (value) => ({ id: 'desc', type: 'rich_text', rich_text: [rt(value)] });
const checkboxProp = (checked) => ({ id: 'draft', type: 'checkbox', checkbox: checked });

export const DATABASE_ID = '1a2b3c4d-0000-4000-8000-000000000001';
export const PAGE_ROW_ID = '11111111-1111-4111-8111-111111111111';
export const SECOND_ROW_ID = '22222222-2222-4222-8222-222222222222';
export const DRAFT_ROW_ID = '33333333-3333-4333-8333-333333333333';

export const database = {
  object: 'database',
  id: DATABASE_ID,
  title: [rt('灵感与理论库')],
  description: [],
  properties: {},
};

export const rows = [
  page(
    PAGE_ROW_ID,
    '测试：Notion 转换全元素覆盖',
    {
      date: dateProp('2025-11-20'),
      tags: multiSelectProp(['测试', '转换']),
      category: selectProp('理论'),
      description: richTextProp('这是一篇用于验证 Notion → Markdown 转换的测试文章，覆盖所有常见 block。'),
      draft: checkboxProp(false),
    },
    { cover: { type: 'external', external: { url: '__BASE__/img/cover.svg' } } }
  ),
  page(SECOND_ROW_ID, '第二篇：页面与标签', {
    date: dateProp('2025-11-10'),
    tags: multiSelectProp(['灵感']),
    category: selectProp('灵感'),
  }),
  page(DRAFT_ROW_ID, '草稿：不应该出现在网站上', {
    draft: checkboxProp(true),
  }),
];

const B = (id) => id;

export const blocks = {
  [PAGE_ROW_ID]: [
    block(B('b-callout'), 'callout', {
      rich_text: [rt('这是一条 callout 提示，转换后应为引用块。')],
      icon: { type: 'emoji', emoji: '💡' },
      color: 'yellow_background',
    }),
    block(B('b-h2'), 'heading_2', { rich_text: [rt('二级标题')], is_toggleable: false }),
    block(B('b-h4'), 'heading_4', { rich_text: [rt('四级标题')], is_toggleable: false }),
    block(B('b-para'), 'paragraph', {
      rich_text: [
        rt('普通文本，包含 '),
        rt('加粗', { bold: true }),
        rt('、'),
        rt('斜体', { italic: true }),
        rt('、'),
        rt('删除线', { strikethrough: true }),
        rt('、'),
        rt('行内代码', { code: true }),
        rt('，以及一个 '),
        rt('链接', {}, 'https://example.com'),
        rt(' 和公式 '),
        eqRt('E = mc^2'),
        rt('。'),
      ],
    }),
    block(B('b-list'), 'bulleted_list_item', { rich_text: [rt('第一层列表项')] }, true),
    block(B('b-num'), 'numbered_list_item', { rich_text: [rt('有序列表项')] }),
    block(B('b-todo1'), 'to_do', { rich_text: [rt('已完成的任务')], checked: true }),
    block(B('b-todo2'), 'to_do', { rich_text: [rt('未完成的任务')], checked: false }),
    block(B('b-toggle'), 'toggle', { rich_text: [rt('点击展开的折叠块')] }, true),
    block(B('b-quote'), 'quote', { rich_text: [rt('这是一段引用文字。')] }),
    block(B('b-code'), 'code', {
      rich_text: [rt('const answer = 42;\nconsole.log(`答案是 ${answer}`);')],
      language: 'javascript',
      caption: [],
    }),
    block(B('b-eq'), 'equation', { expression: 'P(H \\mid E) = \\frac{P(E \\mid H)P(H)}{P(E)}' }),
    block(B('b-image'), 'image', {
      type: 'external',
      external: { url: '__BASE__/img/test-image.svg' },
      caption: [rt('一张示例图片')],
    }),
    block(B('b-bookmark'), 'bookmark', {
      url: 'https://www.notion.so',
      caption: [rt('Notion 官网')],
    }),
    block(B('b-table'), 'table', {
      table_width: 2,
      has_column_header: true,
      has_row_header: false,
    }, true),
    block(B('b-divider'), 'divider', {}),
    block(B('b-child'), 'child_page', { title: '附录：子页面内容' }, true),
    block(B('b-unsupported'), 'unsupported', {}),
  ],
  [B('b-list')]: [
    block(B('b-list-child-1'), 'bulleted_list_item', { rich_text: [rt('嵌套的第一项')] }),
    block(B('b-list-child-2'), 'bulleted_list_item', { rich_text: [rt('嵌套的第二项')] }),
  ],
  [B('b-toggle')]: [block(B('b-toggle-child'), 'paragraph', { rich_text: [rt('折叠块内部的内容。')] })],
  [B('b-table')]: [
    block(B('b-row-1'), 'table_row', {
      cells: [[rt('列 A')], [rt('列 B')]],
    }),
    block(B('b-row-2'), 'table_row', {
      cells: [[rt('值 1')], [rt('值 | 含竖线')]],
    }),
    block(B('b-row-3'), 'table_row', {
      cells: [[rt('值 2')], [rt('值 3')]],
    }),
  ],
  [B('b-child')]: [
    block(B('b-child-para'), 'paragraph', { rich_text: [rt('这是子页面里的正文内容。')] }),
  ],
  [SECOND_ROW_ID]: [
    block(B('s-para'), 'paragraph', { rich_text: [rt('第二篇文章的正文，用于验证多篇排序。')] }),
  ],
  [DRAFT_ROW_ID]: [block(B('d-para'), 'paragraph', { rich_text: [rt('草稿内容。')] })],
};

// 数据库查询返回的页面没有 properties 的额外字段时需要补齐
for (const row of rows) {
  const extra = blocks[row.id] ? {} : {};
  void extra;
}
