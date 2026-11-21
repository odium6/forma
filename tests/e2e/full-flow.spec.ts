import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

/** Builds a valid RGB PNG in memory (correct CRCs), so the app's real decoder accepts it. */
function makePng(w: number, h: number, rgb: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const PNG_A = makePng(30, 40, [90, 170, 120]);
const PNG_B = makePng(30, 40, [60, 150, 90]);

async function next(page: Page) {
  await page.getByTestId('onb-next').click();
}

async function onboard(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'FORMA' })).toBeVisible();
  await next(page);
  await page.getByLabel('Как к тебе обращаться (необязательно)').fill('Тест');
  await page.getByRole('button', { name: 'Женский' }).click();
  await page.getByTestId('onb-year').fill('1990');
  await page.getByTestId('onb-height').fill('170');
  await next(page);
  await page.getByTestId('onb-weight').fill('80');
  await next(page);
  // goal: an unhealthy target only warns — the user may still continue
  await page.getByTestId('goal-target').fill('45');
  await expect(page.getByText('Рекомендуем цель не ниже')).toBeVisible();
  await expect(page.getByTestId('onb-next')).toBeEnabled();
  await page.getByTestId('goal-target').fill('72');
  await expect(page.getByText('Цель реалистична и безопасна.')).toBeVisible();
  await next(page);
  await page.getByLabel('Талия').fill('84');
  await next(page);
  await next(page); // shape
  await expect(page.getByRole('heading', { name: 'Твоя стартовая точка' })).toBeVisible();
  await next(page);
  await expect(page.getByTestId('current-weight')).toHaveText('80,00');
}

test('полный сценарий FORMA', async ({ page, context }) => {
  await onboard(page);

  // ── entry: weight + measurements, duplicate-day handling ──
  await page.getByTestId('home-add-weight').click();
  // wheel picker starts at the last weight (80,00): one kilogram down, then 60 hundredths up
  const kg = page.getByTestId('wheel-kg');
  await expect(kg).toHaveAttribute('aria-valuetext', '80');
  await kg.press('ArrowUp');
  await expect(kg).toHaveAttribute('aria-valuetext', '79');
  const frac = page.getByTestId('wheel-frac');
  for (let i = 0; i < 6; i++) await frac.press('PageDown');
  await expect(frac).toHaveAttribute('aria-valuetext', '60');
  await page.getByRole('button', { name: 'Параметры тела' }).click();
  await page.getByLabel('Бёдра').fill('101');
  await page.getByTestId('entry-save').click();
  await expect(page.getByText('Сохранено: 79,60 кг')).toBeVisible();

  // ── habit: create from preset and mark it done ──
  await page.goto('/#/habits');
  await page.getByTestId('new-habit').click();
  await page.getByRole('button', { name: /Без фастфуда/ }).click();
  await page.getByTestId('habit-save').click();
  await page.getByTestId('habit-check-Без фастфуда').click();
  await expect(page.getByTestId('habit-check-Без фастфуда')).toHaveAttribute('aria-pressed', 'true');

  // ── chart & progress ──
  await page.goto('/#/progress');
  await expect(page.getByRole('img', { name: /График веса/ })).toBeVisible();
  await page.getByRole('radio', { name: 'История' }).click();
  await expect(page.getByTestId('history-row')).toHaveCount(2);

  // ── calendar ──
  await page.goto('/#/calendar');
  await page.locator('.cal-day.today').click();
  await expect(page.getByText('Без фастфуда').last()).toBeVisible();
  await page.keyboard.press('Escape');

  // ── photos: upload two, compare ──
  await page.goto('/#/photos');
  await page.getByTestId('photo-input').setInputFiles([
    { name: 'a.png', mimeType: 'image/png', buffer: PNG_A },
    { name: 'b.png', mimeType: 'image/png', buffer: PNG_B },
  ]);
  await page.getByRole('combobox', { name: 'Ракурс' }).nth(1).selectOption('front');
  await page.getByTestId('photo-save').click();
  await expect(page.getByText('Сохранено фото: 2')).toBeVisible();
  await page.getByTestId('compare-open').click();
  await expect(page.getByTestId('compare-slider-frame')).toBeVisible();
  await page.getByRole('radio', { name: 'Рядом' }).click();
  await expect(page.locator('.cmp-side img')).toHaveCount(2);
  await page.keyboard.press('Escape');

  // ── reports: PDF, CSV, JSON ──
  await page.goto('/#/reports');
  for (const id of ['export-csv', 'export-json', 'export-pdf']) {
    const dl = page.waitForEvent('download');
    await page.getByTestId(id).click();
    const d = await dl;
    const path = await d.path();
    expect(path).toBeTruthy();
    const head = readFileSync(path!).subarray(0, 5).toString('latin1');
    if (id === 'export-pdf') expect(head).toBe('%PDF-');
  }

  // ── achievements were earned from real actions ──
  await page.goto('/#/achievements');
  await expect(page.getByLabel('Первое измерение, получено')).toBeVisible();
  await expect(page.getByLabel('Первый шаг, получено')).toBeVisible();

  // ── backup → wipe → restore ──
  await page.goto('/#/settings/data');
  const dl = page.waitForEvent('download');
  await page.getByTestId('backup-create').click();
  const backupPath = await (await dl).path();
  const backup = JSON.parse(readFileSync(backupPath!, 'utf8'));
  expect(backup.format).toBe('forma-backup');
  expect(backup.data.photos).toHaveLength(2);

  await page.getByTestId('wipe').click();
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByRole('heading', { name: 'FORMA' })).toBeVisible();

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Восстановить из резервной копии' }).click();
  await (await chooser).setFiles(backupPath!);
  await expect(page.getByTestId('current-weight')).toBeVisible();
  await page.goto('/#/photos');
  await expect(page.locator('.photo-cell')).toHaveCount(2);

  // ── offline: the service worker serves the app shell, data comes from IndexedDB ──
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload(); // ensure the page is controlled by the worker
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('current-weight')).toBeVisible();
  await page.goto('/#/habits');
  await expect(page.getByText('Без фастфуда')).toBeVisible();
  await context.setOffline(false);
});

test('тема: светлая, тёмная и системная сохраняются', async ({ page }) => {
  await onboard(page);
  await page.goto('/#/settings/appearance');
  await page.getByRole('radio', { name: 'Тёмная' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('radio', { name: 'Светлая' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByRole('radio', { name: 'Системная' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('PIN защищает фото', async ({ page }) => {
  await onboard(page);
  await page.goto('/#/settings/privacy');
  await page.getByTestId('pin-setup').click();
  await page.getByTestId('pin-a').fill('2468');
  await page.getByTestId('pin-b').fill('2468');
  await page.getByTestId('pin-save').click();
  await expect(page.getByText('PIN-код установлен')).toBeVisible();
  await page.reload();
  await page.goto('/#/photos');
  await expect(page.getByText('Фото защищены')).toBeVisible();
  await page.getByTestId('pin-input').fill('1111');
  await page.getByTestId('pin-submit').click();
  await expect(page.getByText('Неверный PIN')).toBeVisible();
  await page.getByTestId('pin-input').fill('2468');
  await page.getByTestId('pin-submit').click();
  await expect(page.getByTestId('photo-add')).toBeVisible();
  // the PIN itself is never stored
  const stored = await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((r) => {
      const req = indexedDB.open('forma');
      req.onsuccess = () => r(req.result);
    });
    const s = await new Promise<unknown>((r) => {
      const q = db.transaction('kv').objectStore('kv').get('settings');
      q.onsuccess = () => r(q.result);
    });
    return JSON.stringify(s);
  });
  expect(stored).not.toContain('2468');
});
