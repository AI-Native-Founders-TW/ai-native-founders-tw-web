/**
 * 中文斷行：在建置時用 Intl.Segmenter 把句子切成詞，每個詞包成 inline-block，
 * 瀏覽器就只會在詞與詞之間換行（不會出現「槓桿全／台」這種斷法）。標點黏在前一個詞後面。
 *
 *   {phrases(text).map((w) => (w.trim() ? <span class="phrase">{w}</span> : w))}
 *   .phrase { display: inline-block; }
 * 空白會單獨回傳（不能包進 inline-block，否則英文字之間的空白會被吃掉）；沒有中文的句子原樣回傳。
 */
const PUNCT = /^[，。、；：！？）」』》〉,.;:!?)\]]+$/;

export function phrases(text: string, locale = 'zh-Hant'): string[] {
  if (typeof Intl === 'undefined' || !('Segmenter' in Intl) || !/[\u3400-\u9fff]/.test(text))
    return [text];
  const seg = new Intl.Segmenter(locale, { granularity: 'word' });
  const out: string[] = [];
  for (const { segment } of seg.segment(text)) {
    if (out.length && PUNCT.test(segment) && out[out.length - 1].trim())
      out[out.length - 1] += segment;
    else out.push(segment);
  }
  return out;
}
