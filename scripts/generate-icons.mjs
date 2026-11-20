// Rasterises the SVG brand assets into PWA/iOS icons using the locally installed
// Microsoft Edge (or Chrome) via Playwright — no extra image libraries required.
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pub = resolve(import.meta.dirname, '../public');
const icon = readFileSync(resolve(pub, 'icon.svg'), 'utf8');
const maskable = readFileSync(resolve(pub, 'icon-maskable.svg'), 'utf8');

const targets = [
  { svg: icon, size: 192, out: 'pwa-192.png' },
  { svg: icon, size: 512, out: 'pwa-512.png' },
  { svg: maskable, size: 512, out: 'pwa-maskable-512.png' },
  { svg: maskable, size: 180, out: 'apple-touch-icon.png' }, // iOS rounds corners itself
  { svg: icon, size: 64, out: 'favicon-64.png' },
];

const channel = process.env.PW_CHANNEL ?? 'msedge';
const browser = await chromium.launch({ channel });
const page = await browser.newPage();
for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${t.svg.replace('<svg ', `<svg style="display:block;width:${t.size}px;height:${t.size}px" `)}</body></html>`);
  writeFileSync(resolve(pub, t.out), await page.screenshot({ omitBackground: true }));
  console.log('wrote', t.out);
}

// iOS splash screens (portrait) for common iPhone sizes
const splashes = [
  [1179, 2556], [1290, 2796], [1170, 2532], [1284, 2778], [1125, 2436], [828, 1792], [750, 1334], [1206, 2622], [1320, 2868],
];
for (const [w, h] of splashes) {
  await page.setViewportSize({ width: w, height: h });
  for (const dark of [false, true]) {
    const bg = dark ? '#0b100d' : '#f3f5f0';
    const fg = dark ? '#edf2ee' : '#141c17';
    await page.setContent(`<html><body style="margin:0;width:${w}px;height:${h}px;background:${bg};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${w * 0.05}px;font-family:system-ui">
      <div style="width:${w * 0.26}px;height:${w * 0.26}px">${icon.replace('<svg ', '<svg style="width:100%;height:100%" ')}</div>
      <div style="font-size:${w * 0.06}px;font-weight:700;letter-spacing:0.18em;color:${fg}">FORMA</div></body></html>`);
    writeFileSync(resolve(pub, `splash/splash-${w}x${h}${dark ? '-dark' : ''}.png`), await page.screenshot());
  }
}
await browser.close();
