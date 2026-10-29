/**
 * 捲動控制的影格序列播放器（Apple 產品頁的做法）。
 *
 * - 讀 manifest（scripts/media/extract-frames.sh 產生），依裝置選 desktop／mobile 影格。
 * - 先載入整套低解析度 preview（很小），接近章節時才載高解析度；高解析度依「離目前影格多近」排優先序。
 * - 畫在 canvas 上（cover-fit）；只有影格改變或尺寸改變時才重畫。
 *
 * manifest 格式：
 * {
 *   "version": 1,
 *   "poster": "poster.webp",
 *   "variants": {
 *     "preview": { "width": 480, "height": 270, "count": 60, "pattern": "preview/{i}.webp", "pad": 4 },
 *     "desktop": { "width": 1920, "height": 1080, "count": 120, "pattern": "desktop/{i}.webp", "pad": 4 },
 *     "mobile":  { "width": 960, "height": 1280, "count": 60, "pattern": "mobile/{i}.webp", "pad": 4 }
 *   }
 * }
 */

export interface Variant {
  width: number;
  height: number;
  count: number;
  pattern: string;
  pad?: number;
  /** 編號從 1 開始（ffmpeg 預設） */
  start?: number;
}
export interface FrameManifest {
  version: number;
  poster?: string;
  variants: { preview?: Variant; desktop: Variant; mobile?: Variant };
}

/** 讀 manifest；不存在或格式不對時回傳 null（呼叫端改用程式版本）。 */
export async function loadManifest(url: string): Promise<FrameManifest | null> {
  try {
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) return null;
    const m = (await res.json()) as FrameManifest;
    return m?.variants?.desktop?.count ? m : null;
  } catch {
    return null;
  }
}

class FrameSet {
  imgs: (HTMLImageElement | null)[];
  private queued = new Set<number>();
  private inflight = 0;
  private wanted: number[] = [];
  onLoad: () => void = () => {};

  constructor(
    private base: string,
    readonly v: Variant,
    private concurrency = 6,
  ) {
    this.imgs = new Array(v.count).fill(null);
  }

  url(i: number) {
    const n = String(i + (this.v.start ?? 1)).padStart(this.v.pad ?? 4, '0');
    return new URL(this.v.pattern.replace('{i}', n), this.base).href;
  }

  /** 依與 center 的距離排序，載入全部影格 */
  loadAll(center = 0) {
    this.wanted = Array.from({ length: this.v.count }, (_, i) => i)
      .filter((i) => !this.imgs[i] && !this.queued.has(i))
      .sort((a, b) => Math.abs(a - center) - Math.abs(b - center));
    this.pump();
  }

  private pump() {
    while (this.inflight < this.concurrency && this.wanted.length) {
      const i = this.wanted.shift()!;
      if (this.imgs[i] || this.queued.has(i)) continue;
      this.queued.add(i);
      this.inflight++;
      const img = new Image();
      img.decoding = 'async';
      img.src = this.url(i);
      img
        .decode()
        .then(() => {
          this.imgs[i] = img;
          this.onLoad();
        })
        .catch(() => {})
        .finally(() => {
          this.inflight--;
          this.pump();
        });
    }
  }

  /** 最接近 index 的已載入影格 */
  nearest(index: number, radius = 3) {
    for (let r = 0; r <= radius; r++) {
      const a = this.imgs[index - r];
      if (a) return a;
      const b = this.imgs[index + r];
      if (b) return b;
    }
    return null;
  }
}

export class FrameSequence {
  private ctx: CanvasRenderingContext2D;
  private preview: FrameSet | null;
  private main: FrameSet;
  private progress = 0;
  private drawn: HTMLImageElement | null = null;
  private dirty = true;
  private w = 0;
  private h = 0;
  private hiResStarted = false;

  constructor(
    private canvas: HTMLCanvasElement,
    manifestUrl: string,
    manifest: FrameManifest,
    mobile: boolean,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    const base = new URL(manifestUrl, location.href).href;
    const v = (mobile && manifest.variants.mobile) || manifest.variants.desktop;
    this.main = new FrameSet(base, v);
    this.preview = manifest.variants.preview
      ? new FrameSet(base, manifest.variants.preview, 8)
      : null;
    const mark = () => (this.dirty = true);
    this.main.onLoad = mark;
    if (this.preview) this.preview.onLoad = mark;
  }

  /** 章節接近時：先載低解析度 */
  warm() {
    if (this.preview) this.preview.loadAll(0);
    else this.loadHiRes();
  }

  /** 章節進入畫面附近時：載高解析度，從目前影格往外 */
  loadHiRes() {
    if (this.hiResStarted) return;
    this.hiResStarted = true;
    this.main.loadAll(Math.round(this.progress * (this.main.v.count - 1)));
  }

  resize(w: number, h: number) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.round(w * dpr);
    this.h = Math.round(h * dpr);
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.dirty = true;
  }

  setProgress(p: number) {
    if (p === this.progress && !this.dirty) return;
    this.progress = p;
    const mi = Math.round(p * (this.main.v.count - 1));
    let img = this.main.nearest(mi, 2);
    if (!img && this.preview)
      img = this.preview.nearest(Math.round(p * (this.preview.v.count - 1)), 4);
    if (!img) img = this.main.nearest(mi, this.main.v.count);
    if (!img || (img === this.drawn && !this.dirty)) return;
    this.draw(img);
  }

  private draw(img: HTMLImageElement) {
    const { w, h, ctx } = this;
    const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * s;
    const dh = img.naturalHeight * s;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    this.drawn = img;
    this.dirty = false;
  }
}
