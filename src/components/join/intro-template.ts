/**
 * 自介產生器的範本處理。範本本身不存在這裡：build 時從 mono Members/README.md 的
 * 「自介參考範例」取出，依標題把欄位填進 `<…>` 佔位，其餘文字原樣保留。
 * 純函式，不送出任何資料；同時被 React island 與 Vitest 使用。
 */
import { classifyHeading } from '../../graph/parse/intro';

export interface IntroFields {
  name: string;
  github: string;
  about: string;
  contact: string;
  why: string;
  seek: string;
  share: string;
  canHelp: string;
  wantHelp: string;
}

export const emptyFields: IntroFields = {
  name: '',
  github: '',
  about: '',
  contact: '',
  why: '',
  seek: '',
  share: '',
  canHelp: '',
  wantHelp: '',
};

export type FieldHints = Partial<Record<keyof IntroFields, string>>;

/** 取出 Members/README.md 中第一個 ```markdown 區塊；找不到回傳 null */
export function extractIntroTemplate(readme: string): string | null {
  const m = /```markdown\n([\s\S]*?)\n```/.exec(readme.replace(/\r\n?/g, '\n'));
  return m ? m[1] : null;
}

export function cleanGithub(v: string): string {
  const t = v.trim().replace(/^@/, '');
  const m = /github\.com\/([A-Za-z0-9-]+)/i.exec(t);
  return (m ? m[1] : t).replace(/[^A-Za-z0-9-]/g, '').slice(0, 39);
}

/** 未填的欄位留下範本的 `<…>` 提示，讓人一眼看出還缺什麼 */
const or = (v: string | undefined, hint: string) => (v?.trim() ? v.trim() : `<${hint}>`);

function fill(template: string, f?: IntroFields): { md: string; hints: FieldHints } {
  const hints: FieldHints = {};
  const out: string[] = [];
  let section: keyof IntroFields | undefined;
  for (const line of template.split('\n')) {
    const title = /^#\s+<(.+)>\s*$/.exec(line);
    if (title) {
      hints.name = title[1];
      out.push(`# ${or(f?.name, title[1])}`);
      continue;
    }
    const heading = /^#{2,6}\s+(.+)$/.exec(line);
    if (heading) {
      const k = classifyHeading(heading[1]);
      section = k && k !== 'rnr' ? k : undefined;
      out.push(line);
      continue;
    }
    // 「GitHub：<…>」「其他聯絡方式或作品連結：<…>」
    const meta = /^([^：:<]+)[：:]\s*<(.+)>\s*$/.exec(line);
    if (meta) {
      const key = /github/i.test(meta[1]) ? 'github' : 'contact';
      hints[key] = meta[2];
      const gh = cleanGithub(f?.github ?? '');
      const v = key === 'github' ? (gh ? `@${gh}` : '') : (f?.contact.trim() ?? '');
      if (v) out.push(`${meta[1]}：${v}`);
      else if (key === 'github') out.push(line); // 聯絡方式是選填，沒填就整行省略
      continue;
    }
    const ph = /^<(.+)>$/.exec(line.trim());
    if (ph && section) {
      hints[section] = ph[1];
      out.push(or(f?.[section], ph[1]));
      continue;
    }
    out.push(line);
  }
  return { md: out.join('\n'), hints };
}

export const buildMarkdown = (template: string, f: IntroFields): string =>
  `${fill(template, f).md}\n`;

/** 範本裡每個欄位的 `<…>` 提示文字，給表單當說明 */
export const templateHints = (template: string): FieldHints => fill(template).hints;

/** Members/ 底下的檔名：建議 `<GitHub 帳號>.md`（不是資格條件） */
export function introFilename(f: Pick<IntroFields, 'github' | 'name'>): string {
  const gh = cleanGithub(f.github);
  if (gh) return `${gh}.md`;
  const fromName = f.name
    .normalize('NFKC')
    .trim()
    .replace(/[\\/:*?"<>|.]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40);
  return `${fromName || 'my-intro'}.md`;
}

/** 必填：R&R 必須在提交前寫清楚（Members/README） */
export function missingFields(f: IntroFields): (keyof IntroFields)[] {
  const req: (keyof IntroFields)[] = [
    'name',
    'about',
    'why',
    'seek',
    'share',
    'canHelp',
    'wantHelp',
  ];
  return req.filter((k) => !f[k].trim());
}
