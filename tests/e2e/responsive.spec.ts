import { expect, test } from '@playwright/test';

const VIEWPORTS = [
  { name: 'small phone', width: 320, height: 640 },
  { name: 'iPhone', width: 390, height: 844 },
  { name: 'large phone', width: 430, height: 932 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'laptop', width: 1366, height: 768 },
  { name: 'monitor', width: 2560, height: 1440 },
];
const ROUTES = ['/', '/progress', '/habits', '/calendar', '/photos', '/achievements', '/reports', '/settings', '/more'];

test.describe('адаптивность', () => {
  test.skip(({ isMobile }) => isMobile, 'viewport is set explicitly below');

  test('нет горизонтальной прокрутки ни на одном экране', async ({ page }) => {
    // seed a minimal profile through the real UI
    await page.goto('/');
    await page.getByTestId('onb-next').click();
    await page.getByRole('button', { name: 'Мужской' }).click();
    await page.getByTestId('onb-year').fill('1985');
    await page.getByTestId('onb-height').fill('182');
    await page.getByTestId('onb-next').click();
    await page.getByTestId('onb-weight').fill('92,5');
    await page.getByTestId('onb-next').click();
    await page.getByTestId('goal-target').fill('84');
    for (let i = 0; i < 4; i++) await page.getByTestId('onb-next').click();
    await expect(page.getByTestId('current-weight')).toBeVisible();

    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const r of ROUTES) {
        await page.goto(`/#${r}`);
        await page.waitForTimeout(250);
        // body hides overflow-x, so look for any visible element that sticks out of the viewport
        const offenders = await page.evaluate(() => {
          const out: string[] = [];
          const clipped = (el: Element) => {
            for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
              const o = getComputedStyle(p).overflowX;
              if (o === 'auto' || o === 'hidden' || o === 'scroll' || o === 'clip') return true;
            }
            return false;
          };
          for (const el of document.querySelectorAll('#root *')) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if ((r.right > window.innerWidth + 1 || r.left < -1) && !clipped(el)) out.push(`${el.tagName}.${(el as HTMLElement).className}`);
          }
          return out.slice(0, 5);
        });
        expect(offenders, `${vp.name} ${vp.width}px ${r}`).toEqual([]);
      }
    }
  });
});
