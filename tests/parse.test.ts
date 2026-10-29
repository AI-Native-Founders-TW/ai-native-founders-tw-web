import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildMarkdown,
  extractIntroTemplate,
  introFilename,
  templateHints,
} from '../src/components/join/intro-template';
import { Identity } from '../src/graph/identity';
import { parseActionTable, parseOwners } from '../src/graph/parse/actions';
import {
  extractContributorSection,
  parseContributorsFile,
  parseNameList,
} from '../src/graph/parse/contributors';
import {
  aggregateAuthors,
  GIT_LOG_FORMAT,
  loginFromEmail,
  parseGitLog,
} from '../src/graph/parse/git';
import { classifyHeading, extractGithub, parseIntro } from '../src/graph/parse/intro';

// fixtures/*.md 是虛構的測試資料，只模仿 mono 的格式（自介、會議行動表、資訊貢獻者段落）
const fx = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('自介寬鬆解析', () => {
  it('完全照範本填寫：抽出所有欄位', () => {
    const filled = fx('intro-template.md')
      .replace('<佔位：名字>', '小明')
      .replace('<佔位：我是誰>', '中文系大三，還在探索創業。')
      .replace('<佔位：GitHub>', '@xiaoming-dev')
      .replace('<佔位：聯絡方式>', 'https://xiaoming.dev')
      .replace('<佔位：為什麼想加入>', '想認識一起做產品的人。')
      .replace('<佔位：想要獲得什麼>', '想知道怎麼開始做 side project。')
      .replace('<佔位：想分享什麼>', '寫作與訪談的經驗。')
      .replace('<佔位：可以幫什麼忙>', '- 文案校稿\n- 訪談逐字稿整理')
      .replace('<佔位：想要幫什麼忙>', '想學 landing page 怎麼做');
    const r = parseIntro(filled, 'Members/xiaoming-dev.md');
    expect(r.name).toBe('小明');
    expect(r.github).toBe('xiaoming-dev');
    expect(r.about).toBe('中文系大三，還在探索創業。');
    expect(r.about).not.toMatch(/GitHub|xiaoming\.dev/);
    expect(r.why).toBe('想認識一起做產品的人。');
    expect(r.seek).toBe('想知道怎麼開始做 side project。');
    expect(r.share).toBe('寫作與訪談的經驗。');
    expect(r.canHelp).toEqual(['文案校稿', '訪談逐字稿整理']);
    expect(r.wantHelp).toEqual(['想學 landing page 怎麼做']);
    expect(r.links).toEqual(['https://xiaoming.dev']);
    expect(r.structured).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it('沒改過的範本：佔位文字視為未填，只發警告', () => {
    const r = parseIntro(fx('intro-template.md'), 'Members/x.md');
    expect(r.name).toBeUndefined();
    expect(r.github).toBeUndefined();
    expect(r.canHelp).toEqual([]);
    expect(r.wantHelp).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('自由格式（沒有標題）：保留全文', () => {
    const md = '# Alice\n\n我在做 AI 客服產品，想找人聊出海。\n\n歡迎找我聊 B2B SaaS。';
    const r = parseIntro(md, 'Members/alice.md');
    expect(r.name).toBe('Alice');
    expect(r.structured).toBe(false);
    expect(r.about).toContain('AI 客服產品');
    expect(r.about).toContain('B2B SaaS');
    expect(r.warnings.some((w) => w.includes('整篇顯示'))).toBe(true);
  });

  it('英文標題與行內標籤也能對應', () => {
    const md = [
      '# Bob',
      '## About me',
      'PM at a fintech.',
      'GitHub: https://github.com/bob-the-pm',
      '**Can help with**: user interviews, PRD review',
      '**Want to help with**: events',
    ].join('\n');
    const r = parseIntro(md);
    expect(r.github).toBe('bob-the-pm');
    expect(r.about).toBe('PM at a fintech.');
    expect(r.canHelp).toEqual(['user interviews, PRD review']);
    expect(r.wantHelp).toEqual(['events']);
  });

  it('R&R 沒有拆成兩段時不猜，保留原文', () => {
    const md = '# C\n\n## 我是誰\n\n工程師\n\n## R&R\n\n可以幫忙看後端架構，也想學行銷。';
    const r = parseIntro(md);
    expect(r.canHelp).toEqual([]);
    expect(r.wantHelp).toEqual([]);
    expect(r.rnr).toContain('後端架構');
  });

  it('標題分類：R&R 標題同時含兩種關鍵字時歸為 rnr', () => {
    expect(classifyHeading('我的 R&R：可以幫什麼忙、想要幫什麼忙')).toBe('rnr');
    expect(classifyHeading('想要幫什麼忙')).toBe('wantHelp');
    expect(classifyHeading('可以幫什麼忙')).toBe('canHelp');
    expect(classifyHeading('想要獲得什麼')).toBe('seek');
    expect(classifyHeading('想分享什麼')).toBe('share');
    expect(classifyHeading('為什麼想加入')).toBe('why');
  });

  it('GitHub 帳號：拒絕佔位與組織帳號', () => {
    expect(extractGithub('<你的 GitHub 帳號>')).toBeUndefined();
    expect(extractGithub('https://github.com/AI-Native-Founders-TW')).toBeUndefined();
    expect(extractGithub('@octocat（主要帳號）')).toBe('octocat');
  });

  it('空檔案不會丟例外', () => {
    expect(parseIntro('', 'Members/empty.md').warnings[0]).toContain('空');
  });
});

describe('資訊貢獻者', () => {
  it('名單：括號內是別名', () => {
    expect(parseNameList('水球、有平（Chris）、Ray（Ray貓）、Sun。')).toEqual([
      { name: '水球', aliases: [] },
      { name: '有平', aliases: ['Chris'] },
      { name: 'Ray', aliases: ['Ray貓'] },
      { name: 'Sun', aliases: [] },
    ]);
  });

  it('括號內的頓號不切開；清單格式也可以', () => {
    expect(parseNameList('Kun（ThisWeb、前端）、Sun')).toEqual([
      { name: 'Kun', aliases: ['ThisWeb', '前端'] },
      { name: 'Sun', aliases: [] },
    ]);
    expect(parseNameList('- 水球\n- Jasmine').map((t) => t.name)).toEqual(['水球', 'Jasmine']);
  });

  it('文件末尾的段落（申請制度）', () => {
    const names = extractContributorSection(fx('contributor-section.md'));
    expect(names?.map((n) => n.name)).toEqual(['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛']);
  });

  it('條文標題含「資訊貢獻者」字樣不算', () => {
    const md = '## 第一章\n\n### 第 1 條（資訊貢獻者的規定）\n\n1. 測試用的虛構條文。\n';
    expect(extractContributorSection(md)).toBeNull();
  });

  it('沒有段落時回傳 null', () => {
    expect(extractContributorSection('# 標題\n\n內文')).toBeNull();
  });

  it('獨立的資訊貢獻者.md：找出署名目標與名單，不把說明句當名字', () => {
    const r = parseContributorsFile(fx('contributors-file.md'));
    expect(r.targets).toEqual(['vision.md']);
    expect(r.names).toHaveLength(8);
    expect(r.names.some((n) => n.name.includes('本文件'))).toBe(false);
  });
});

describe('會議行動表', () => {
  const items = parseActionTable(fx('action-table.md'));

  it('抽出 A1–A13', () => {
    expect(items.map((i) => i.id)).toEqual(Array.from({ length: 13 }, (_, i) => `A${i + 1}`));
  });

  it('編號括號內是短名；負責欄拆出協作', () => {
    const a5 = items.find((i) => i.id === 'A5');
    expect(a5?.title).toBe('網站開工');
    expect(a5?.owners).toEqual([
      { name: '丙', role: 'owner' },
      { name: '丁', role: 'collab' },
    ]);
    expect(items.find((i) => i.id === 'A13')?.owners).toEqual([{ name: '戊', role: 'owner' }]);
  });

  it('全員不是一個人；「未訂」期限不輸出', () => {
    const a1 = items.find((i) => i.id === 'A1');
    expect(a1?.everyone).toBe(true);
    expect(a1?.owners).toEqual([]);
    expect(a1?.due).toBeUndefined();
  });

  it('parseOwners 處理多種分隔', () => {
    expect(parseOwners('Sun、Yapi 協助').owners).toEqual([
      { name: 'Sun', role: 'owner' },
      { name: 'Yapi', role: 'collab' },
    ]);
  });
});

describe('git 作者', () => {
  const log = [
    ['a1', 'Octo Cat', '123+octocat@users.noreply.github.com', '2026-10-20T10:00:00+08:00'],
    ['a2', 'octocat', 'octocat@users.noreply.github.com', '2026-10-22T10:00:00+08:00'],
    ['a3', 'Johnny Pan', 'johnny@example.com', '2026-10-21T10:00:00+08:00'],
    [
      'a4',
      'dependabot[bot]',
      '49699333+dependabot[bot]@users.noreply.github.com',
      '2026-10-21T10:00:00+08:00',
    ],
  ]
    .map((r) => `${r.join('\x1f')}\x1e`)
    .join('\n');

  it('格式字串使用分隔字元', () => expect(GIT_LOG_FORMAT).toContain('%x1f'));

  it('noreply email 轉帳號', () => {
    expect(loginFromEmail('123+octocat@users.noreply.github.com')).toBe('octocat');
    expect(loginFromEmail('octocat@users.noreply.github.com')).toBe('octocat');
    expect(loginFromEmail('johnny@example.com')).toBeUndefined();
  });

  it('同一帳號合併、排除 bot、記錄最近日期', () => {
    const authors = aggregateAuthors(parseGitLog(log));
    expect(authors).toHaveLength(2);
    expect(authors[0]).toMatchObject({
      login: 'octocat',
      count: 2,
      last: '2026-10-22T10:00:00+08:00',
    });
    expect(authors[1]).toMatchObject({ name: 'Johnny Pan', login: undefined, count: 1 });
  });
});

describe('別名合併', () => {
  const seeds = [
    { key: 'ray', name: 'Ray 貓', aliases: ['Ray', 'Ray貓', 'Ray 貓'] },
    { key: 'chris', name: '有平', aliases: ['Chris'] },
    { key: 'yayapipi', name: 'yayapipi', aliases: ['Yapi'] },
    { key: 'claude', name: 'Claude', kind: 'tool' as const },
  ];

  it('Ray／Ray貓／Ray 貓 是同一人；全形空白與大小寫不影響', () => {
    const id = new Identity(seeds);
    const a = id.resolve({ name: 'Ray' });
    const b = id.resolve({ name: 'Ray貓' });
    const c = id.resolve({ name: 'ray　貓' });
    expect(a.id).toBe('name:ray');
    expect(b.id).toBe(a.id);
    expect(c.id).toBe(a.id);
    expect(a.name).toBe('Ray 貓');
  });

  it('括號別名也能合併：有平（Chris）、Yapi', () => {
    const id = new Identity(seeds);
    expect(id.resolve({ name: 'Chris' }).id).toBe('name:chris');
    expect(id.resolve({ name: '有平', aliases: ['Chris'] }).id).toBe('name:chris');
    expect(id.resolve({ name: 'Yapi' }).id).toBe('name:yayapipi');
  });

  it('工具用 tool: 前綴；未知的人新建，不猜', () => {
    const id = new Identity(seeds);
    expect(id.idForKey('claude')).toBe('tool:claude');
    const j = id.resolve({ name: 'Johnny Pan', email: 'j@example.com' });
    expect(j.id).toBe('name:johnny-pan');
    expect(j.github).toBeUndefined();
    expect(id.resolve({ email: 'j@example.com' }).id).toBe(j.id);
  });

  it('有 GitHub 帳號時以帳號為主鍵，並帶頭像', () => {
    const id = new Identity([{ key: 'sun', name: 'Sun', github: 'sun-dev' }]);
    const p = id.resolve({ name: 'Sun' });
    expect(p.id).toBe('sun-dev');
    expect(p.avatar).toContain('sun-dev');
    expect(id.resolve({ github: 'SUN-DEV' }).id).toBe('sun-dev');
  });

  it('後來才得知帳號：補上 github，但 id 不變', () => {
    const id = new Identity(seeds);
    const p = id.resolve({ name: 'Ray', github: 'ray-cat' });
    expect(p.id).toBe('name:ray');
    expect(p.github).toBe('ray-cat');
  });
});

describe('自介產生器', () => {
  it('產生的 Markdown 可以被解析器讀回來', () => {
    const md = buildMarkdown(fx('intro-template.md'), {
      name: '小明',
      github: 'xiaoming',
      about: '學生',
      contact: '',
      why: '想學',
      seek: '認識人',
      share: '筆記',
      canHelp: '- 校稿\n- 翻譯',
      wantHelp: '活動',
    });
    const r = parseIntro(md);
    expect(r.name).toBe('小明');
    expect(r.github).toBe('xiaoming');
    expect(r.canHelp).toEqual(['校稿', '翻譯']);
    expect(r.wantHelp).toEqual(['活動']);
  });

  it('未填的欄位保留範本的 <…> 提示；聯絡方式沒填就省略整行', () => {
    const md = buildMarkdown(fx('intro-template.md'), {
      name: '小明',
      github: '',
      about: '',
      contact: '',
      why: '',
      seek: '',
      share: '',
      canHelp: '',
      wantHelp: '',
    });
    expect(md).toContain('<佔位：我是誰>');
    expect(md).toContain('GitHub：<佔位：GitHub>');
    expect(md).not.toContain('作品連結');
  });

  it('範本提示依標題對應欄位', () => {
    const hints = templateHints(fx('intro-template.md'));
    expect(hints.name).toBe('佔位：名字');
    expect(hints.about).toBe('佔位：我是誰');
    expect(hints.canHelp).toBe('佔位：可以幫什麼忙');
    expect(hints.wantHelp).toBe('佔位：想要幫什麼忙');
  });

  it('從 README 取出 markdown 區塊；沒有就回傳 null', () => {
    const readme = `# 說明\n\n\`\`\`markdown\n# <名字>\n\`\`\`\n`;
    expect(extractIntroTemplate(readme)).toBe('# <名字>');
    expect(extractIntroTemplate('# 沒有範本')).toBeNull();
  });

  it('檔名：優先用 GitHub 帳號，避免不安全字元', () => {
    expect(introFilename({ github: '@Ray-Cat', name: '' })).toBe('Ray-Cat.md');
    expect(introFilename({ github: '', name: 'Ray 貓/../x' })).toBe('Ray-貓-x.md');
    expect(introFilename({ github: '', name: '' })).toBe('my-intro.md');
  });
});
