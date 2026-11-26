import { test, expect, type Page } from '@playwright/test';

async function enterApp(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Select vault|Seleccionar bóveda/i }).click();
}

async function openSettings(page: Page) {
  await page.getByRole('button', { name: /Settings and vault|Ajustes y bóveda/i }).first().click();
}

test('settings tabs stay in a 3+2 mosaic and the modal size is stable', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 1920 });
  await enterApp(page);
  await openSettings(page);

  const tabs = page.locator('.settings-tabs .settings-tab');
  await expect(tabs).toHaveCount(5);

  const boxes = await tabs.evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { y: Math.round(rect.y), h: Math.round(rect.height) };
    }),
  );
  const rows = new Set(boxes.map((box) => box.y));
  expect(rows.size).toBe(2);
  expect(boxes.filter((box) => box.y === Math.min(...rows))).toHaveLength(3);
  expect(boxes.filter((box) => box.y === Math.max(...rows))).toHaveLength(2);

  const sizes: string[] = [];
  for (const name of [/Appearance|Apariencia/i, /Backups|Copias/i, /About|Acerca/i]) {
    await page.getByRole('tab', { name }).click();
    const box = await page.locator('.modal').boundingBox();
    expect(box).not.toBeNull();
    sizes.push(`${Math.round(box!.width)}x${Math.round(box!.height)}`);
  }
  expect(new Set(sizes).size).toBe(1);
});

test('12 backups do not cover the settings tab bar', async ({ page }) => {
  await enterApp(page);
  await openSettings(page);
  await page.getByRole('tab', { name: /Backups|Copias/i }).click();

  await page.evaluate(() => {
    const panel = document.querySelector('.settings-tab-panel:not([hidden])');
    const list = document.createElement('div');
    list.className = 'snapshot-list';
    list.style.cssText = 'max-height:none;display:flex;flex-direction:column;gap:8px';
    for (let i = 0; i < 12; i += 1) {
      const item = document.createElement('div');
      item.className = 'snapshot-item';
      item.style.cssText = 'min-height:56px;padding:10px;border:1px solid #888';
      item.textContent = `Snapshot ${i}`;
      list.appendChild(item);
    }
    panel?.appendChild(list);
    const body = document.querySelector('.modal-body');
    if (body) body.scrollTop = body.scrollHeight;
  });

  const bar = await page.locator('.settings-tabs').boundingBox();
  expect(bar).not.toBeNull();
  expect(bar!.height).toBeGreaterThanOrEqual(50);
  const tabVisible = await page.getByRole('tab', { name: /Appearance|Apariencia/i }).isVisible();
  expect(tabVisible).toBe(true);
});

test('water target notice stays inside the card with readable contrast in light theme', async ({ page }) => {
  await enterApp(page);
  await page.evaluate(() => localStorage.setItem('bt.theme', 'light'));
  await page.reload();
  await page.getByRole('tab', { name: /Water|Agua/i }).click();

  const banner = page.locator('.water-banner');
  await expect(banner).toBeVisible();
  const target = banner.locator('.notice-info').filter({ hasText: /Water target|Agua objetivo/i });
  await expect(target).toHaveCount(1);
  const text = await target.innerText();
  expect(text).toMatch(/Calculated from|Calculado a partir de/i);
  expect(text).toMatch(/min\/week|min\/semana/i);

  const styles = await target.evaluate((node) => {
    const computed = getComputedStyle(node);
    return { color: computed.color, background: computed.backgroundColor, border: computed.borderColor };
  });
  expect(styles.color).not.toBe(styles.background);
  expect(styles.border).not.toBe('rgba(0, 0, 0, 0)');
});
