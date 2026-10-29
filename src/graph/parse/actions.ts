/**
 * 解析 mono `logs/*會議記錄.md` 的「行動表」（編號／行動／負責）。
 * 結果是組織紀錄中的分工，不是本人的自介；網站只用於 AI-Native 示範並標明出處。
 */
import { cleanInline, parseTables } from './markdown';

export interface ActionOwner {
  name: string;
  /** 「kun 協作」→ collab */
  role: 'owner' | 'collab';
}

export interface ActionItem {
  /** A1、A13… */
  id: string;
  /** 編號後括號內的短名，例如「Landing Page 開工」；沒有就取行動前段 */
  title: string;
  action: string;
  owners: ActionOwner[];
  /** 「全員」 */
  everyone: boolean;
  due?: string;
}

const col = (header: string[], re: RegExp) => header.findIndex((h) => re.test(h));

export function parseOwners(cell: string): { owners: ActionOwner[]; everyone: boolean } {
  const owners: ActionOwner[] = [];
  let everyone = false;
  for (const raw of cleanInline(cell).split(/[；;、,，/／]|\s+and\s+|\s*&\s*/)) {
    let t = raw.trim();
    if (!t) continue;
    if (/^(全員|所有人|大家|everyone|all)$/i.test(t)) {
      everyone = true;
      continue;
    }
    let role: ActionOwner['role'] = 'owner';
    const collab = /^(.+?)\s*(?:協作|協助|支援|collab(?:orat(?:e|or|ion))?)$/i.exec(t);
    if (collab) {
      role = 'collab';
      t = collab[1].trim();
    }
    t = t.replace(/^[（(]|[）)]$/g, '').trim();
    if (t && t.length <= 30) owners.push({ name: t, role });
  }
  return { owners, everyone };
}

export function parseActionTable(md: string): ActionItem[] {
  const items: ActionItem[] = [];
  for (const table of parseTables(md)) {
    const iId = col(table.header, /編號|^id$|^#$/i);
    const iAction = col(table.header, /^行動$|action|事項|待辦/i);
    const iOwner = col(table.header, /負責|owner|assignee/i);
    const iDue = col(table.header, /期限|due|deadline/i);
    if (iAction < 0 || iOwner < 0) continue;
    for (const row of table.rows) {
      const idCell = cleanInline(row[Math.max(iId, 0)] ?? '');
      const m = /^([A-Za-z]\d+)\s*(?:[（(]([^）)]+)[）)])?/.exec(idCell);
      if (!m) continue;
      const action = cleanInline(row[iAction] ?? '');
      const { owners, everyone } = parseOwners(row[iOwner] ?? '');
      const due = iDue >= 0 ? cleanInline(row[iDue] ?? '') : undefined;
      items.push({
        id: m[1].toUpperCase(),
        title: m[2]?.trim() || action.split(/[；;，,。]/)[0].slice(0, 24),
        action,
        owners,
        everyone,
        due: due && !/^(未訂|無|-|—)$/.test(due) ? due : undefined,
      });
    }
  }
  return items;
}
