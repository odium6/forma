import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
// Static WOFF (not variable WOFF2): fontkit can subset these into valid embedded TrueType.
import cyrUrl from '@fontsource/onest/files/onest-cyrillic-400-normal.woff?url';
import latUrl from '@fontsource/onest/files/onest-latin-400-normal.woff?url';
import cyrBoldUrl from '@fontsource/onest/files/onest-cyrillic-600-normal.woff?url';
import latBoldUrl from '@fontsource/onest/files/onest-latin-600-normal.woff?url';
import type { Report } from '@/lib/reports';
import { formatDate } from '@/lib/dates';
import { fmtNum, fmtSigned } from '@/lib/format';

/**
 * Vector PDF report built with pdf-lib. Onest is embedded (subset) for Cyrillic and Latin,
 * so text stays selectable and renders identically everywhere.
 */

const C = {
  ink: rgb(0.08, 0.11, 0.09),
  muted: rgb(0.36, 0.4, 0.37),
  faint: rgb(0.62, 0.66, 0.63),
  line: rgb(0.9, 0.92, 0.89),
  green: rgb(0.13, 0.63, 0.32),
  deep: rgb(0.06, 0.36, 0.21),
  lime: rgb(0.78, 0.95, 0.31),
  bg: rgb(0.95, 0.96, 0.94),
};

interface FontPair {
  cyr: PDFFont;
  lat: PDFFont;
}
interface Fonts extends FontPair {
  bold: FontPair;
}

const isCyr = (ch: string) => /[Ѐ-ӿ№]/.test(ch);

/** Splits text into runs per font: the Cyrillic subset has no space/digits, so those use the Latin font. */
function runs(text: string): { t: string; cyr: boolean }[] {
  const out: { t: string; cyr: boolean }[] = [];
  for (const ch of text) {
    const cyr = isCyr(ch);
    const last = out[out.length - 1];
    if (last && last.cyr === cyr) last.t += ch;
    else out.push({ t: ch, cyr });
  }
  return out;
}

function sanitize(s: string): string {
  // characters outside both subsets are replaced so pdf-lib never throws on them
  return s.replace(/[−]/g, '-').replace(/[^ -ɏЀ-ӿ–—№ «»…·]/g, '');
}

function width(f: FontPair, text: string, size: number): number {
  return runs(sanitize(text)).reduce((w, r) => w + (r.cyr ? f.cyr : f.lat).widthOfTextAtSize(r.t, size), 0);
}

function draw(page: PDFPage, fonts: Fonts, text: string, x: number, y: number, size: number, color = C.ink, align: 'left' | 'right' = 'left', bold = false) {
  const f = bold ? fonts.bold : fonts;
  let cx = align === 'right' ? x - width(f, text, size) : x;
  for (const r of runs(sanitize(text))) {
    const font = r.cyr ? f.cyr : f.lat;
    page.drawText(r.t, { x: cx, y, size, font, color });
    cx += font.widthOfTextAtSize(r.t, size);
  }
}

function wrap(f: Fonts, text: string, size: number, maxW: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (width(f, t, size) > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

export async function buildReportPDF(r: Report, opts: { name: string; target: number | null; photos: { label: string; jpeg: ArrayBuffer }[] }): Promise<Blob> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`FORMA — отчёт ${r.from} — ${r.to}`);
  doc.setProducer('FORMA');
  doc.setCreator('FORMA');
  const fontBytes = await Promise.all([cyrUrl, latUrl, cyrBoldUrl, latBoldUrl].map((u) => fetch(u).then((x) => x.arrayBuffer())));
  const [cyr, lat, cyrB, latB] = await Promise.all(fontBytes.map((b) => doc.embedFont(b, { subset: true })));
  const f: Fonts = { cyr, lat, bold: { cyr: cyrB, lat: latB } };

  const W = 595.28;
  const H = 841.89;
  const M = 44;
  let page = doc.addPage([W, H]);
  let y = H - M;

  const ensure = (h: number) => {
    if (y - h < M) {
      page = doc.addPage([W, H]);
      y = H - M;
    }
  };
  const heading = (t: string) => {
    ensure(40);
    y -= 14;
    draw(page, f, t, M, y, 14, C.ink, 'left', true);
    y -= 10;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: C.line });
    y -= 16;
  };

  // header with the brand mark
  page.drawRectangle({ x: M, y: y - 26, width: 26, height: 26, color: C.deep });
  page.drawRectangle({ x: M + 8, y: y - 21, width: 3.6, height: 16, color: C.lime });
  page.drawRectangle({ x: M + 8, y: y - 8.6, width: 8.5, height: 3.6, color: C.lime });
  page.drawRectangle({ x: M + 8, y: y - 14.4, width: 6.5, height: 3.4, color: C.lime });
  page.drawCircle({ x: M + 19.8, y: y - 6.8, size: 1.9, color: C.lime });
  draw(page, f, 'FORMA', M + 36, y - 18, 15, C.ink, 'left', true);
  draw(page, f, `Отчёт · ${formatDate(r.from, { year: true })} — ${formatDate(r.to, { year: true })}`, W - M, y - 12, 10, C.muted, 'right');
  if (opts.name) draw(page, f, opts.name, W - M, y - 25, 9, C.faint, 'right');
  y -= 50;

  // summary tiles
  const w = r.weight;
  const tiles: [string, string][] = [
    ['Начальный вес', w.start != null ? `${fmtNum(w.start, 1)} кг` : '—'],
    ['Конечный вес', w.end != null ? `${fmtNum(w.end, 1)} кг` : '—'],
    ['Изменение', w.change != null ? `${fmtSigned(w.change, 1)} кг` : '—'],
    ['Средний вес', w.average != null ? `${fmtNum(w.average, 1)} кг` : '—'],
    ['Изменение тренда', w.trendChange != null ? `${fmtSigned(w.trendChange, 1)} кг` : '—'],
    ['Дней с измерениями', `${w.loggedDays} из ${r.days}`],
    ['Привычки', r.habitRate != null ? `${Math.round(r.habitRate * 100)}%` : '—'],
    ['Достижения', String(r.achievements.length)],
  ];
  const tw = (W - 2 * M - 3 * 8) / 4;
  tiles.forEach(([label, value], i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = M + col * (tw + 8);
    const ty = y - row * 58;
    page.drawRectangle({ x, y: ty - 50, width: tw, height: 50, color: C.bg });
    draw(page, f, label, x + 10, ty - 17, 8, C.muted);
    draw(page, f, value, x + 10, ty - 37, 14, C.ink, 'left', true);
  });
  y -= 2 * 58 + 10;

  // weight chart
  if (w.points.length > 1) {
    heading('Динамика веса');
    const ch = 170;
    const cx0 = M + 30;
    const cw = W - M - cx0;
    const vals = [...w.points.map((p) => p.value), ...w.trend, ...(opts.target != null ? [opts.target] : [])];
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (hi - lo < 1) { lo -= 0.5; hi += 0.5; }
    const pad = (hi - lo) * 0.08;
    lo -= pad; hi += pad;
    const d0 = w.points[0].day;
    const d1 = Math.max(d0 + 1, w.points[w.points.length - 1].day);
    const X = (d: number) => cx0 + ((d - d0) / (d1 - d0)) * cw;
    const Y = (v: number) => y - ch + ((v - lo) / (hi - lo)) * ch;
    for (let i = 0; i <= 4; i++) {
      const v = lo + ((hi - lo) * i) / 4;
      page.drawLine({ start: { x: cx0, y: Y(v) }, end: { x: W - M, y: Y(v) }, thickness: 0.4, color: C.line });
      draw(page, f, fmtNum(v, 1), cx0 - 6, Y(v) - 3, 7, C.faint, 'right');
    }
    if (opts.target != null && opts.target >= lo && opts.target <= hi) {
      page.drawLine({ start: { x: cx0, y: Y(opts.target) }, end: { x: W - M, y: Y(opts.target) }, thickness: 1, color: C.green, dashArray: [2, 3] });
      draw(page, f, `Цель ${fmtNum(opts.target, 1)}`, W - M, Y(opts.target) + 4, 7, C.green, 'right');
    }
    for (const p of w.points) page.drawCircle({ x: X(p.day), y: Y(p.value), size: 1.6, borderColor: C.faint, borderWidth: 0.8, color: rgb(1, 1, 1) });
    for (let i = 1; i < w.points.length; i++) {
      if (w.points[i].day - w.points[i - 1].day > 21) continue;
      page.drawLine({ start: { x: X(w.points[i - 1].day), y: Y(w.trend[i - 1]) }, end: { x: X(w.points[i].day), y: Y(w.trend[i]) }, thickness: 1.8, color: C.green });
    }
    draw(page, f, formatDate(w.points[0].date), cx0, y - ch - 14, 7, C.faint);
    draw(page, f, formatDate(w.points[w.points.length - 1].date), W - M, y - ch - 14, 7, C.faint, 'right');
    y -= ch + 30;
    draw(page, f, '○ измерения   — сглаженный тренд   - - цель', cx0, y, 7.5, C.muted);
    y -= 10;
  }

  const table = (head: string[], rows: string[][], colW: number[]) => {
    ensure(24);
    let x = M;
    head.forEach((h, i) => {
      draw(page, f, h, i === 0 ? x : x + colW[i] - 4, y, 8, C.muted, i === 0 ? 'left' : 'right');
      x += colW[i];
    });
    y -= 8;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: C.line });
    y -= 13;
    for (const row of rows) {
      ensure(18);
      x = M;
      row.forEach((c, i) => {
        draw(page, f, c, i === 0 ? x : x + colW[i] - 4, y, 9, C.ink, i === 0 ? 'left' : 'right');
        x += colW[i];
      });
      y -= 16;
    }
    y -= 6;
  };

  const metrics = [...(r.bodyFat.count ? [r.bodyFat] : []), ...r.measurements];
  if (metrics.length) {
    heading('Измерения тела');
    table(
      ['Параметр', 'Начало', 'Конец', 'Изменение', 'Замеров'],
      metrics.map((m) => [
        m.label,
        m.first ? `${fmtNum(m.first.value, 1)} ${m.unit}` : '—',
        m.last ? `${fmtNum(m.last.value, 1)} ${m.unit}` : '—',
        m.change != null ? `${fmtSigned(m.change, 1)} ${m.unit}` : '—',
        String(m.count),
      ]),
      [170, 85, 85, 85, 82],
    );
  }

  if (r.habits.length) {
    heading('Привычки');
    table(
      ['Привычка', 'Выполнено', 'Запланировано', 'Доля', 'Лучшая серия'],
      r.habits.map((h) => [h.name, String(h.done), String(h.scheduled), h.rate != null ? `${Math.round(h.rate * 100)}%` : '—', String(h.bestStreakInPeriod)]),
      [190, 75, 90, 70, 82],
    );
  }

  if (r.achievements.length) {
    heading('Достижения за период');
    for (const a of r.achievements) {
      ensure(18);
      draw(page, f, a.title, M, y, 10, C.ink);
      draw(page, f, formatDate(a.date, { year: true }), W - M, y, 9, C.muted, 'right');
      y -= 17;
    }
  }

  if (opts.photos.length) {
    heading('Фото');
    const pw = (W - 2 * M - 2 * 10) / 3;
    let col = 0;
    for (const ph of opts.photos) {
      const img = await doc.embedJpg(ph.jpeg);
      const ratio = img.height / img.width;
      const h = Math.min(pw * ratio, 220);
      const iw = h / ratio;
      if (col === 0) ensure(h + 24);
      const x = M + col * (pw + 10);
      page.drawImage(img, { x: x + (pw - iw) / 2, y: y - h, width: iw, height: h });
      draw(page, f, ph.label, x, y - h - 12, 8, C.muted);
      col++;
      if (col === 3) {
        col = 0;
        y -= h + 26;
      }
    }
    if (col) y -= 240;
  }

  ensure(40);
  y -= 6;
  for (const line of wrap(f, 'Расчёты FORMA основаны на ваших измерениях и прозрачных формулах (сглаживание, устойчивая регрессия). Отчёт не является медицинским заключением.', 7.5, W - 2 * M)) {
    draw(page, f, line, M, y, 7.5, C.faint);
    y -= 10;
  }

  const pages = doc.getPages();
  pages.forEach((p, i) => draw(p, f, `${i + 1} / ${pages.length}`, W - M, 24, 7.5, C.faint, 'right'));
  const bytes = await doc.save();
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
}
