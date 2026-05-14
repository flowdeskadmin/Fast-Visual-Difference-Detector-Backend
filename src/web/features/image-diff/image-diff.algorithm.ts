/**
 * Server-side mirror of the client algorithm in
 * `frontend/src/lib/diff/algorithm.ts`. They use the same `pixelmatch`
 * implementation and the same sensitivity → threshold mapping so that
 * flipping the engine toggle in the UI keeps the bounding boxes stable.
 *
 * The only deltas are:
 *   - Inputs arrive as `sharp` instances (file decoding happens via sharp,
 *     not the browser's createImageBitmap).
 *   - We accept arbitrarily large inputs and pad them on the fly. sharp's
 *     `extend` operation runs in native code which makes server-side a good
 *     fit for huge screenshots.
 */

import pixelmatch from 'pixelmatch';

export type ServerBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  pixels: number;
};

export type AlgorithmTuning = {
  pixelThreshold: number;
  dilation: number;
  minArea: number;
  mergeGap: number;
};

export function resolveTuning(sensitivity: number, width: number, height: number): AlgorithmTuning {
  const s = Math.max(0, Math.min(100, sensitivity)) / 100;
  const pixelThreshold = 0.5 * Math.exp(-3 * s) + 0.005;
  const minDim = Math.min(width, height);
  const dilation = Math.max(1, Math.round(minDim / 300));
  const minArea = Math.max(4, Math.round(80 * (1 - s)));
  const mergeGap = Math.max(4, Math.round(minDim / 200));
  return { pixelThreshold, dilation, minArea, mergeGap };
}

export type ComputeDiffArgs = {
  before: Buffer;
  after: Buffer;
  width: number;
  height: number;
  sensitivity: number;
  ignoreAntialiasing: boolean;
};

export function computeDiff({
  before,
  after,
  width,
  height,
  sensitivity,
  ignoreAntialiasing,
}: ComputeDiffArgs): { boxes: ServerBox[]; changedPixels: number } {
  const tuning = resolveTuning(sensitivity, width, height);
  const diffBuffer = Buffer.alloc(width * height * 4);

  const changedPixels = pixelmatch(before, after, diffBuffer, width, height, {
    threshold: tuning.pixelThreshold,
    includeAA: !ignoreAntialiasing,
    alpha: 0.1,
  });

  if (changedPixels === 0) {
    return { boxes: [], changedPixels: 0 };
  }

  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < diffBuffer.length; i += 4, p++) {
    const r = diffBuffer[i];
    const b = diffBuffer[i + 2];
    if (r > 200 && b < 80) mask[p] = 1;
  }

  const dilated = tuning.dilation > 0 ? dilate(mask, width, height, tuning.dilation) : mask;
  const components = labelComponents(dilated, width, height, tuning.minArea);
  const merged = mergeBoxes(components, tuning.mergeGap);

  return { boxes: merged, changedPixels };
}

function dilate(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const intermediate = new Uint8Array(w * h);
  const output = new Uint8Array(w * h);
  const r = radius;

  for (let y = 0; y < h; y++) {
    const row = y * w;
    let count = 0;
    for (let x = 0; x <= r && x < w; x++) count += mask[row + x];
    for (let x = 0; x < w; x++) {
      intermediate[row + x] = count > 0 ? 1 : 0;
      const addX = x + r + 1;
      const removeX = x - r;
      if (addX < w) count += mask[row + addX];
      if (removeX >= 0) count -= mask[row + removeX];
    }
  }

  for (let x = 0; x < w; x++) {
    let count = 0;
    for (let y = 0; y <= r && y < h; y++) count += intermediate[y * w + x];
    for (let y = 0; y < h; y++) {
      output[y * w + x] = count > 0 ? 1 : 0;
      const addY = y + r + 1;
      const removeY = y - r;
      if (addY < h) count += intermediate[addY * w + x];
      if (removeY >= 0) count -= intermediate[removeY * w + x];
    }
  }

  return output;
}

type ComponentStats = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pixels: number;
};

function labelComponents(
  mask: Uint8Array,
  w: number,
  h: number,
  minArea: number,
): ServerBox[] {
  const labels = new Uint32Array(w * h);
  let parent = new Int32Array(1024);
  let nextLabel = 1;

  const ensureParentCap = (cap: number) => {
    if (cap < parent.length) return;
    let n = parent.length;
    while (n <= cap) n *= 2;
    const grown = new Int32Array(n);
    grown.set(parent);
    parent = grown;
  };

  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };

  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (ra < rb) parent[rb] = ra;
    else parent[ra] = rb;
  };

  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const p = row + x;
      if (mask[p] === 0) continue;
      const left = x > 0 ? labels[p - 1] : 0;
      const up = y > 0 ? labels[p - w] : 0;
      const upLeft = x > 0 && y > 0 ? labels[p - w - 1] : 0;
      const upRight = x < w - 1 && y > 0 ? labels[p - w + 1] : 0;

      let label = 0;
      if (left) label = label === 0 ? left : Math.min(label, left);
      if (up) label = label === 0 ? up : Math.min(label, up);
      if (upLeft) label = label === 0 ? upLeft : Math.min(label, upLeft);
      if (upRight) label = label === 0 ? upRight : Math.min(label, upRight);

      if (label === 0) {
        ensureParentCap(nextLabel);
        parent[nextLabel] = nextLabel;
        label = nextLabel++;
      } else {
        if (left && left !== label) union(label, left);
        if (up && up !== label) union(label, up);
        if (upLeft && upLeft !== label) union(label, upLeft);
        if (upRight && upRight !== label) union(label, upRight);
      }
      labels[p] = label;
    }
  }

  const stats = new Map<number, ComponentStats>();
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const lbl = labels[row + x];
      if (lbl === 0) continue;
      const root = find(lbl);
      const s = stats.get(root);
      if (s) {
        if (x < s.minX) s.minX = x;
        if (x > s.maxX) s.maxX = x;
        if (y < s.minY) s.minY = y;
        if (y > s.maxY) s.maxY = y;
        s.pixels++;
      } else {
        stats.set(root, { minX: x, minY: y, maxX: x, maxY: y, pixels: 1 });
      }
    }
  }

  const boxes: ServerBox[] = [];
  for (const s of stats.values()) {
    if (s.pixels < minArea) continue;
    boxes.push({
      x: s.minX,
      y: s.minY,
      width: s.maxX - s.minX + 1,
      height: s.maxY - s.minY + 1,
      pixels: s.pixels,
    });
  }
  return boxes;
}

function mergeBoxes(boxes: ServerBox[], gap: number): ServerBox[] {
  if (boxes.length <= 1) return boxes;
  const sorted = [...boxes].sort((a, b) => b.width * b.height - a.width * a.height);

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j];
        if (
          a.x - gap <= b.x + b.width &&
          b.x - gap <= a.x + a.width &&
          a.y - gap <= b.y + b.height &&
          b.y - gap <= a.y + a.height
        ) {
          const minX = Math.min(a.x, b.x);
          const minY = Math.min(a.y, b.y);
          const maxX = Math.max(a.x + a.width, b.x + b.width);
          const maxY = Math.max(a.y + a.height, b.y + b.height);
          sorted[i] = {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
            pixels: a.pixels + b.pixels,
          };
          sorted.splice(j, 1);
          changed = true;
          j--;
        }
      }
    }
  }
  return sorted;
}
