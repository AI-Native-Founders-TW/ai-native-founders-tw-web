/**
 * 自介產生器（React island）。
 * - 範本由 build 時從 mono Members/README 取出後傳入；逐欄填寫 → 即時預覽 Markdown → 用 links.newIntro 開 GitHub 建立檔案。
 * - 不送出任何資料到其他地方；草稿只存在 localStorage。
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { links } from '../../config/links';
import {
  buildMarkdown,
  emptyFields,
  type IntroFields,
  introFilename,
  missingFields,
  templateHints,
} from './intro-template';
import './IntroBuilder.css';

type FieldCopy = { label: string; hint?: string; placeholder?: string };
export interface BuilderCopy {
  groups: { id: string; title: string; note?: string }[];
  fields: Record<keyof IntroFields, FieldCopy>;
  optional: string;
  preview: string;
  filename: string;
  copy: string;
  copied: string;
  reset: string;
  resetConfirm: string;
  progress: string;
  missing: string;
  review: string;
  confirm: string;
  submit: string;
  submitHint: string;
  tooLong: string;
  guide: string;
}

const GROUPS: Record<string, { key: keyof IntroFields; multiline?: boolean; rows?: number }[]> = {
  you: [
    { key: 'name' },
    { key: 'github' },
    { key: 'about', multiline: true, rows: 4 },
    { key: 'contact' },
  ],
  why: [
    { key: 'why', multiline: true, rows: 3 },
    { key: 'seek', multiline: true, rows: 3 },
    { key: 'share', multiline: true, rows: 3 },
  ],
  rnr: [
    { key: 'canHelp', multiline: true, rows: 4 },
    { key: 'wantHelp', multiline: true, rows: 4 },
  ],
};
const OPTIONAL = new Set<keyof IntroFields>(['github', 'contact']);
const STORAGE = 'anf:intro-draft:v1';
const URL_SOFT_LIMIT = 7500;

function Highlighted({ md }: { md: string }) {
  return (
    <>
      {md.split('\n').map((line, i) => {
        const cls = /^#{1,3}\s/.test(line)
          ? `ib-md-h ib-md-h${line.indexOf(' ')}`
          : /^<.*>$/.test(line.trim()) || /：<.*>$/.test(line)
            ? 'ib-md-ph'
            : /^(GitHub|其他聯絡方式或作品連結)：/.test(line)
              ? 'ib-md-meta'
              : /^\s*[-*]\s/.test(line)
                ? 'ib-md-li'
                : '';
        return (
          <span key={i} className={`ib-md-line ${cls}`}>
            <span className="ib-md-no" aria-hidden="true">
              {i + 1}
            </span>
            <span className="ib-md-text">{line || ' '}</span>
          </span>
        );
      })}
    </>
  );
}

export default function IntroBuilder({
  copy,
  template,
}: {
  copy: BuilderCopy;
  /** mono Members/README.md 的自介參考範例 */
  template: string;
}) {
  const [f, setF] = useState<IntroFields>(emptyFields);
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);
  const loaded = useRef(false);
  const uid = useId();

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE);
      if (saved) setF({ ...emptyFields, ...JSON.parse(saved) });
    } catch {}
    loaded.current = true;
  }, []);
  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(STORAGE, JSON.stringify(f));
    } catch {}
  }, [f]);

  const md = useMemo(() => buildMarkdown(template, f), [template, f]);
  const hints = useMemo(() => templateHints(template), [template]);
  const filename = useMemo(() => introFilename(f), [f]);
  const missing = missingFields(f);
  const required = Object.keys(emptyFields).filter((k) => !OPTIONAL.has(k as keyof IntroFields));
  const done = required.length - missing.length;
  const url = links.newIntro(filename, md);
  const ready = missing.length === 0 && confirmed;

  const set = (k: keyof IntroFields) => (e: { target: { value: string } }) => {
    setF((prev) => ({ ...prev, [k]: e.target.value }));
    setConfirmed(false);
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };
  const onReset = () => {
    if (!window.confirm(copy.resetConfirm)) return;
    setF(emptyFields);
    setConfirmed(false);
    try {
      localStorage.removeItem(STORAGE);
    } catch {}
  };

  let n = 0;
  return (
    <div className="ib">
      <form
        className="ib-form"
        onSubmit={(e) => e.preventDefault()}
        aria-describedby={`${uid}-progress`}
      >
        {copy.groups.map((g, gi) => (
          <fieldset key={g.id} className="ib-group">
            <legend className="ib-legend">
              <span className="ib-legend-no">{String(gi + 1).padStart(2, '0')}</span>
              {g.title}
            </legend>
            {g.note && <p className="ib-note">{g.note}</p>}
            {(GROUPS[g.id] ?? []).map(({ key, multiline, rows }) => {
              const c = copy.fields[key];
              // 文案沒寫說明的欄位，用 mono 範本的 <…> 提示
              const hint = c.hint ?? hints[key];
              const id = `${uid}-${key}`;
              const filled = Boolean(f[key].trim());
              n++;
              return (
                <div key={key} className="ib-field" data-filled={filled || undefined}>
                  <label htmlFor={id} className="ib-label">
                    <span className="ib-label-no" aria-hidden="true">
                      {filled ? '✓' : String(n).padStart(2, '0')}
                    </span>
                    <span>{c.label}</span>
                    {OPTIONAL.has(key) && <span className="ib-optional">{copy.optional}</span>}
                  </label>
                  {hint && (
                    <p id={`${id}-hint`} className="ib-hint">
                      {hint}
                    </p>
                  )}
                  {multiline ? (
                    <textarea
                      id={id}
                      className="ib-input ib-textarea"
                      rows={rows}
                      value={f[key]}
                      onChange={set(key)}
                      placeholder={c.placeholder}
                      aria-describedby={hint ? `${id}-hint` : undefined}
                      required={!OPTIONAL.has(key)}
                    />
                  ) : (
                    <input
                      id={id}
                      className="ib-input"
                      value={f[key]}
                      onChange={set(key)}
                      placeholder={c.placeholder}
                      aria-describedby={hint ? `${id}-hint` : undefined}
                      required={!OPTIONAL.has(key)}
                      autoComplete={key === 'name' ? 'nickname' : 'off'}
                      spellCheck={key !== 'github' && key !== 'contact'}
                      inputMode={key === 'contact' ? 'url' : undefined}
                    />
                  )}
                </div>
              );
            })}
          </fieldset>
        ))}
      </form>

      <aside className="ib-side">
        <div className="ib-preview">
          <div className="ib-bar">
            <span className="ib-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="ib-path" title={`Members/${filename}`}>
              <span className="ib-path-dim">Members/</span>
              {filename}
            </span>
            <span className="ib-badge">{copy.preview}</span>
          </div>
          <div className="ib-progress" id={`${uid}-progress`}>
            <div className="ib-progress-track" aria-hidden="true">
              <div
                className="ib-progress-fill"
                style={{ width: `${(done / required.length) * 100}%` }}
              />
            </div>
            <span>
              {copy.progress} {done}/{required.length}
            </span>
          </div>
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: 可捲動的程式碼區塊要能用鍵盤捲動 */}
          {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: 同上，讓螢幕閱讀器讀得到區塊名稱 */}
          <pre className="ib-code" aria-label={copy.preview} tabIndex={0}>
            <code>
              <Highlighted md={md} />
            </code>
          </pre>
          <div className="ib-tools">
            <button type="button" className="ib-tool" onClick={onCopy}>
              {copied ? copy.copied : copy.copy}
            </button>
            <button type="button" className="ib-tool ib-tool--dim" onClick={onReset}>
              {copy.reset}
            </button>
          </div>
        </div>

        <div className="ib-submit">
          <p className="ib-review">
            <span className="ib-review-icon" aria-hidden="true">
              !
            </span>
            {copy.review}
          </p>
          {missing.length > 0 && (
            <p className="ib-missing" aria-live="polite">
              {copy.missing}：{missing.map((k) => copy.fields[k].label).join('、')}
            </p>
          )}
          <label className="ib-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              disabled={missing.length > 0}
            />
            <span>{copy.confirm}</span>
          </label>
          <a
            className="pg-btn ib-go"
            href={ready ? url : undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!ready}
            onClick={(e) => {
              if (!ready) e.preventDefault();
            }}
          >
            <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            {copy.submit}
            <span className="pg-arrow" aria-hidden="true">
              ↗
            </span>
          </a>
          <p className="ib-hint ib-hint--center">{copy.submitHint}</p>
          {url.length > URL_SOFT_LIMIT && <p className="ib-warn">{copy.tooLong}</p>}
          <a
            className="pg-link ib-guide"
            href={links.membersGuide}
            target="_blank"
            rel="noopener noreferrer"
          >
            {copy.guide} ↗
          </a>
        </div>
      </aside>
    </div>
  );
}
