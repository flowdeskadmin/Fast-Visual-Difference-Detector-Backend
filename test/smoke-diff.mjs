// Quick smoke test against a running backend. Generates two tiny PNGs
// in-memory, posts them to /api/diff and prints the response.
//
// Usage:   node test/smoke-diff.mjs [http://localhost:8000]
import sharp from 'sharp';

const baseUrl = process.argv[2] || 'http://localhost:8000';

async function makePng({ background, dots }) {
  let img = sharp({
    create: {
      width: 200,
      height: 120,
      channels: 4,
      background,
    },
  });
  if (dots.length) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120">${dots
      .map(
        (d) =>
          `<rect x="${d.x}" y="${d.y}" width="${d.w}" height="${d.h}" fill="${d.color}"/>`,
      )
      .join('')}</svg>`;
    img = img.composite([{ input: Buffer.from(svg), top: 0, left: 0 }]);
  }
  return img.png().toBuffer();
}

const before = await makePng({
  background: { r: 255, g: 255, b: 255, alpha: 1 },
  dots: [
    { x: 20, y: 20, w: 30, h: 30, color: 'red' },
    { x: 100, y: 60, w: 40, h: 30, color: 'blue' },
  ],
});
const after = await makePng({
  background: { r: 255, g: 255, b: 255, alpha: 1 },
  dots: [
    { x: 20, y: 20, w: 30, h: 30, color: 'red' },
    { x: 110, y: 60, w: 40, h: 30, color: 'green' },
  ],
});

const fd = new FormData();
fd.append('before', new Blob([before], { type: 'image/png' }), 'before.png');
fd.append('after', new Blob([after], { type: 'image/png' }), 'after.png');
fd.append('sensitivity', '60');

const res = await fetch(`${baseUrl}/api/diff`, { method: 'POST', body: fd });
if (!res.ok) {
  console.error(`HTTP ${res.status}`);
  console.error(await res.text());
  process.exit(1);
}
const json = await res.json();
console.log(JSON.stringify(json, null, 2));
