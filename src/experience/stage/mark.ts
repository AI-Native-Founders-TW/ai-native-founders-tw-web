/**
 * Logo「A＋波浪＋光點」的向量近似（512×512 座標，取樣自 public/brand/logo-512.png）。
 * Sun 提供正式 SVG 後，換掉這三個值即可；Boot、降級舞台、OG 圖都讀這裡。
 */
export const MARK = {
  viewBox: '0 0 512 512',
  /** 左腳＋頂點＋右肩（白 → 淡紫） */
  leg: 'M128 345 L236 170 Q258 134 282 166 L318 212',
  /** 波浪右腳（靛 → 天藍） */
  wave: 'M262 247 C286 222 316 213 338 234 C362 258 382 318 414 350',
  /** 右上的光點（＝「你」） */
  dot: { cx: 400, cy: 190, r: 23 },
  stroke: 52,
} as const;

/** 光點在 512 座標中的相對位置（0..1），給 Boot 揭幕遮罩用 */
export const DOT_REL = { x: MARK.dot.cx / 512, y: MARK.dot.cy / 512 };
