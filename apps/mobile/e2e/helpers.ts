/// <reference types="node" />
import { expect, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

let counter = 0;
export const uniqueEmail = (name: string) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}-${counter++}@example.com`;

/** Signs in through the real Email OTP flow; the code comes from the test-only route (absent in production). */
export async function signIn(page: Page, name: string, email = uniqueEmail(name)) {
  await page.goto('/');
  await page.getByTestId('email-input').fill(email);
  await page.getByTestId('send-code').click();
  await expect(page.getByTestId('code-input')).toBeVisible();
  const res = await page.request.get(`/api/test/otp?email=${encodeURIComponent(email)}`);
  const { code } = await res.json();
  await page.getByTestId('code-input').fill(code);
  await page.getByTestId('verify-code').click();
  await page.getByTestId('name-input').fill(name);
  await page.getByTestId('name-continue').click();
  await expect(page.getByTestId('today-screen')).toBeVisible();
  return email;
}

export async function newUser(browser: Browser, name: string) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page, name);
  return { ctx, page, errors };
}

export async function setLanguage(page: Page, lang: 'en' | 'ar') {
  await page.goto('/me');
  await page.getByTestId(`me-lang-${lang}`).click();
  await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
}

/**
 * Text that is clipped (content wider than its box without an intentional ellipsis) or pushed outside the viewport.
 * Elements inside horizontal scrollers (chip rows) are allowed to extend past the edge.
 */
export async function findClippedText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const inHScroll = (el: Element) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && p.scrollWidth > p.clientWidth) return true;
      }
      return false;
    };
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim());
      if (!own) continue;
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const truncates = s.textOverflow === 'ellipsis' || (s.webkitLineClamp && s.webkitLineClamp !== 'none');
      const text = (el.textContent ?? '').trim().slice(0, 50);
      if (!truncates && el.scrollWidth > el.clientWidth + 2 && s.overflowX !== 'visible') out.push(`clipped: ${text}`);
      if (!inHScroll(el) && (r.right > window.innerWidth + 1 || r.left < -1)) out.push(`offscreen: ${text}`);
    }
    return out;
  });
}

export function shotDir(version: string) {
  const dir = join(__dirname, 'screenshots', version);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function shoot(page: Page, version: string, name: string) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(shotDir(version), `${name}.png`), fullPage: false });
  const clipped = await findClippedText(page);
  expect(clipped, `clipped text on ${name}`).toEqual([]);
}
