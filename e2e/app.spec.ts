import { expect, test, type Page } from '@playwright/test';

// The production bundle against the mock backend: every view renders, the everyday actions work,
// and nothing throws. If any of this fails, the deploy does not happen.

const VIEWS = ['today', 'calendar', 'tasks', 'lists', 'shifts', 'week', 'plans'] as const;

async function signIn(page: Page, errors: string[]) {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    // the mock refuses the realtime websocket on purpose; anything else is a real error
    if (m.type() === 'error' && !m.text().includes('WebSocket')) errors.push(m.text());
  });
  await page.request.post('http://127.0.0.1:54321/__reset');
  await page.goto('./');
  await expect(page.locator('#auth-dialog')).toBeVisible();
  await page.fill('#auth-form input[name=email]', 'sam@example.com');
  await page.fill('#auth-form input[name=password]', 'sidequest-demo');
  await page.click('#auth-submit');
  await expect(page.locator('#view-today h1')).toContainText('Sam');
}

async function go(page: Page, view: string) {
  const mobile = await page.locator('.mobile-nav').isVisible();
  const nav = page.locator(`${mobile ? '.mobile-nav' : '.sidebar'} .nav-item[data-view=${view}]`);
  if (await nav.count()) await nav.click();
  else await page.locator(`.focus-toolbar [data-view=${view}]`).click();
  await expect(page.locator(`#view-${view}`)).toHaveClass(/active-view/);
}

test('every view renders with data and no errors', async ({ page }) => {
  const errors: string[] = [];
  await signIn(page, errors);
  for (const view of VIEWS) {
    if (view === 'week') await go(page, 'today');
    await go(page, view);
    await expect(page.locator(`#view-${view} .page-heading h1`)).toBeVisible();
  }
  await go(page, 'today');
  await expect(page.locator('#view-today')).toContainText('Dinner at Marta');
  await expect(page.locator('#view-today')).toContainText('Pay the electricity bill');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});

test('Coming up shows each day once', async ({ page }) => {
  await signIn(page, []);
  const labels = await page.locator('#view-today .coming-day').allTextContents();
  expect(new Set(labels).size).toBe(labels.length);
});

test('complete a task and it leaves the due list', async ({ page }) => {
  const errors: string[] = [];
  await signIn(page, errors);
  const row = page.locator('#view-today .row-item', { hasText: 'Book train tickets' });
  await row.locator('.check-action').click();
  await expect(page.locator('#view-today')).not.toContainText('Book train tickets', { timeout: 5000 });
  expect(errors).toEqual([]);
});

test('add an item to a shared list', async ({ page }) => {
  await signIn(page, []);
  await go(page, 'lists');
  const list = page.locator('#view-lists').locator('form[data-list-item-form]').first();
  await list.locator('input').fill('Basil');
  await list.locator('input').press('Enter');
  await expect(page.locator('#view-lists')).toContainText('Basil');
});

test('create a task from the add button', async ({ page }) => {
  await signIn(page, []);
  await page.click('#add-button');
  if (await page.locator('#add-dialog').isVisible()) await page.click('#add-dialog [data-create=task]');
  await expect(page.locator('#item-dialog')).toBeVisible();
  await page.fill('#item-form input[name=title]', 'Buy a birthday card');
  await page.click('#save-item');
  await go(page, 'tasks');
  await expect(page.locator('#view-tasks')).toContainText('Buy a birthday card');
});
