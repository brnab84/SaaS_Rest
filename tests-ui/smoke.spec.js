import { test, expect } from '@playwright/test';

async function login(page, email) {
  await page.goto('/app/');
  await page.fill('#email', email);
  await page.fill('#password', 'test1234');
  await page.click('#login-btn');
  await expect(page.locator('.shell')).toBeVisible({ timeout: 15000 });
}

test('panel: comercio normal — todas las pestañas cargan sin error de consola', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await login(page, 'qa@test.local');
  // el topbar muestra el email de la cuenta activa
  await expect(page.locator('.user-email')).toHaveText('qa@test.local', { timeout: 10000 });
  for (const id of ['resumen', 'menu', 'pedidos', 'gastos', 'campanias', 'mensajes', 'ajustes']) {
    await page.locator(`.tab[data-nav="${id}"]`).click();
    await expect(page.locator('.view-head h1')).toBeVisible();
  }
  // Gastos: solapas + vista tabla deben renderizar (cubre "Por evento" y la tabla tipo Excel)
  await page.locator('.tab[data-nav="gastos"]').click();
  await page.locator('.seg-btn[data-gt="eventos"]').click();
  await expect(page.locator('#new-ev')).toBeVisible();
  await page.locator('.seg-btn[data-gt="generales"]').click();
  await expect(page.locator('.exp-summary .sum-amt')).toBeVisible(); // resumen (total) de la hoja
  await page.locator('.seg-btn[data-view="table"]').click();
  await expect(page.locator('.xls tbody tr [data-f="total"]').first()).toBeVisible({ timeout: 10000 }); // planilla nativa
  await page.locator('.seg-btn[data-view="cards"]').click();
  // un comercio normal NO debe ver la pestaña ni el botón Admin
  await expect(page.locator('.tab[data-nav="admin"]')).toHaveCount(0);
  await expect(page.locator('.btn-admin')).toHaveCount(0);
  expect(errors, `errores de consola:\n${errors.join('\n')}`).toEqual([]);
});

// Helper: en la planilla nativa, la última fila (sin data-id) es la fila en blanco para cargar.
async function gotoPlanilla(page) {
  await login(page, 'qa@test.local');
  await page.locator('.tab[data-nav="gastos"]').click();
  await page.locator('.seg-btn[data-view="table"]').click();
  await expect(page.locator('.xls tbody tr [data-f="total"]').first()).toBeVisible({ timeout: 10000 });
}
const totalValues = (page) => page.locator('.xls [data-f="total"]').evaluateAll((els) => els.map((e) => e.value));
const productValues = (page) => page.locator('.xls [data-f="product"]').evaluateAll((els) => els.map((e) => e.value));

test('panel: editar el Precio de una fila existente persiste', async ({ page }) => {
  await gotoPlanilla(page);
  const cell = page.locator('.xls tbody tr [data-f="total"]').first();
  await cell.fill('73219');
  await cell.press('Tab'); // blur → change → guarda (PATCH)
  await page.waitForTimeout(700);
  await page.reload();
  expect(await totalValues(page)).toContain('73219');
});

test('panel: cargar el Precio en la fila en blanco crea el gasto', async ({ page }) => {
  await gotoPlanilla(page);
  const row = page.locator('.xls tbody tr').last(); // fila en blanco
  await row.locator('[data-f="product"]').fill('Servilletas QA');
  await row.locator('[data-f="total"]').fill('800');
  await row.locator('[data-f="total"]').press('Tab'); // change → crea (POST)
  await page.waitForTimeout(800);
  await page.reload();
  expect(await productValues(page)).toContain('Servilletas QA');
});

test('panel: borrar una fila (✕) persiste', async ({ page }) => {
  await gotoPlanilla(page);
  const row = page.locator('.xls tbody tr').last();
  await row.locator('[data-f="product"]').fill('Borrarme QA');
  await row.locator('[data-f="total"]').fill('99');
  await row.locator('[data-f="total"]').press('Tab');
  await page.waitForTimeout(700);
  expect(await productValues(page)).toContain('Borrarme QA');
  // borrar la fila cuyo producto es "Borrarme QA"
  await page.evaluate(() => {
    const tr = [...document.querySelectorAll('.xls tbody tr')].find((t) => t.querySelector('[data-f="product"]')?.value === 'Borrarme QA');
    tr?.querySelector('[data-delrow]')?.click();
  });
  await page.locator('.modal-footer [data-yes]').click();
  await page.waitForTimeout(700);
  await page.reload();
  expect(await productValues(page)).not.toContain('Borrarme QA');
});

test('panel: gastos en hojas (pestañas)', async ({ page }) => {
  await login(page, 'qa@test.local');
  await page.locator('.tab[data-nav="gastos"]').click();
  await expect(page.locator('.sheet-tab[data-sheet="general"]')).toBeVisible();
  page.once('dialog', (d) => d.accept('Insumos QA')); // prompt del nombre de la hoja
  await page.click('#sheet-add');
  await expect(page.locator('.sheet-tab', { hasText: 'Insumos QA' })).toBeVisible({ timeout: 10000 });
});

test('panel: agregar columna propia a la planilla', async ({ page }) => {
  await login(page, 'qa@test.local');
  await page.locator('.tab[data-nav="gastos"]').click();
  await page.locator('.seg-btn[data-view="table"]').click();
  await expect(page.locator('.xls tbody tr [data-f="total"]').first()).toBeVisible({ timeout: 10000 });
  page.once('dialog', (d) => d.accept('N factura QA')); // prompt del nombre de la columna
  await page.click('#col-add');
  await expect(page.locator('.xls thead th', { hasText: 'N factura QA' })).toBeVisible({ timeout: 10000 });
});

test('panel: la cuenta root ve la pestaña Admin y abre el panel', async ({ page }) => {
  await login(page, 'root@test.local');
  await expect(page.locator('.user-email')).toHaveText('root@test.local', { timeout: 10000 });
  // botón Admin fijo en la barra superior (siempre visible, no depende del scroll del nav)
  const adminBtn = page.locator('.btn-admin');
  await expect(adminBtn).toBeVisible({ timeout: 10000 }); // aparece tras detectRoot
  await adminBtn.click();
  await expect(page.locator('.view-head h1')).toContainText('Administración');
});

test('panel: recargar estando ya logueado no rompe (regresión TDZ _msgPollStarted)', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await login(page, 'root@test.local');
  await page.reload(); // carga con la sesión ya iniciada (token en localStorage): este camino crasheaba
  await expect(page.locator('.shell')).toBeVisible();
  await expect(page.locator('.btn-admin')).toBeVisible({ timeout: 10000 }); // detectRoot corre tras el arranque
  await expect(page.locator('.user-email')).toHaveText('root@test.local');
  expect(errors, `errores de consola:\n${errors.join('\n')}`).toEqual([]);
});

test('storefront: la landing carga el menú', async ({ page }) => {
  await page.goto('/r/qa-demo');
  await expect(page.locator('.hero h1')).toBeVisible();
  await expect(page.locator('.prod').first()).toBeVisible();
});
