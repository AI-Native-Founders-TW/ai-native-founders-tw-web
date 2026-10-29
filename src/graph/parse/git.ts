/**
 * git log → 作者彙整。git 指令的執行放在 build-graph（Node），這裡只處理字串，方便測試。
 */

/** `git log` 要用的格式：欄位以 \x1f 分隔，commit 以 \x1e 分隔 */
export const GIT_LOG_FORMAT = '%H%x1f%an%x1f%ae%x1f%aI%x1e';

export interface Commit {
  sha: string;
  name: string;
  email: string;
  date: string;
}

export function parseGitLog(output: string): Commit[] {
  return output
    .split('\x1e')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [sha, name, email, date] = r.split('\x1f');
      return {
        sha,
        name: name?.trim() ?? '',
        email: email?.trim().toLowerCase() ?? '',
        date: date?.trim() ?? '',
      };
    })
    .filter((c) => c.sha && (c.name || c.email));
}

/** GitHub noreply email → 帳號：`123+octocat@users.noreply.github.com`、`octocat@users.noreply.github.com` */
export function loginFromEmail(email: string): string | undefined {
  const m = /^(?:\d+\+)?([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))@users\.noreply\.github\.com$/i.exec(
    email.trim(),
  );
  return m?.[1];
}

export function isBot(name: string, email: string): boolean {
  return (
    /\[bot\]$/i.test(name) ||
    /\[bot\]@/i.test(email) ||
    /^(github-actions|dependabot|renovate)/i.test(name)
  );
}

export interface Author {
  name: string;
  email: string;
  login?: string;
  count: number;
  first: string;
  last: string;
  /** 任一筆 commit 的 sha，有 GITHUB_TOKEN 時用來查帳號 */
  sampleSha: string;
}

/** 依 email（或 noreply 帳號）合併同一作者；排除 bot */
export function aggregateAuthors(commits: Commit[]): Author[] {
  const map = new Map<string, Author>();
  for (const c of commits) {
    if (isBot(c.name, c.email)) continue;
    const login = loginFromEmail(c.email);
    const key = login ? `gh:${login.toLowerCase()}` : `em:${c.email || c.name.toLowerCase()}`;
    const a = map.get(key);
    if (!a) {
      map.set(key, {
        name: c.name,
        email: c.email,
        login,
        count: 1,
        first: c.date,
        last: c.date,
        sampleSha: c.sha,
      });
      continue;
    }
    a.count++;
    if (c.date < a.first) a.first = c.date;
    if (c.date > a.last) a.last = c.date;
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
