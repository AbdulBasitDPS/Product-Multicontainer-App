import { test, expect } from "@playwright/test";

const apiUrl = process.env.UI_TEST_API_URL || "http://localhost:8080";

test("website public pages retain a wide table and resize cleanly", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Log in to your workspace" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Account access" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/login-wide.png",
    fullPage: true,
  });
  await page.goto("/products");
  await expect(
    page.getByRole("heading", { name: "Products", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Loading products/)).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add product" })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: "test-results/products-wide.png",
    fullPage: true,
  });
  const sidebar = await page.locator(".sidebar").boundingBox();
  expect(sidebar!.width).toBeGreaterThan(175);
  expect(sidebar!.width).toBeLessThan(250);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "Products", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("registration, JWT session, CRUD, low-stock events, and CSV imports work with the backend", async ({
  page,
  request,
}) => {
  const suffix = Date.now().toString();
  const email = `ui-check-${suffix}@example.test`;
  const sku = `UI-${suffix}`;
  const importedSku = `CSV-${suffix}`;
  const productName = `Browser check ${suffix}`;
  const importName = `CSV check ${suffix}`;
  let token = "";
  const ids = new Set<number>();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.goto("/register");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill("BrowserCheck123!");
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(page).toHaveURL(/\/products$/);
    await expect(
      page.getByRole("button", { name: "Add product", exact: true }),
    ).toBeVisible();
    token = await page.evaluate(
      () => JSON.parse(sessionStorage.getItem("precision-session")!).token,
    );
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Add product", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Live updates", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "Add product", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name", { exact: true }).fill(productName);
    await dialog.getByLabel("SKU", { exact: true }).fill(sku);
    await dialog.getByLabel("Price", { exact: true }).fill("12.50");
    await dialog.getByLabel("Stock", { exact: true }).fill("2");
    await dialog.getByLabel(/Category/).fill("browser-check");
    const createdResponse = page.waitForResponse(
      (response) =>
        response.url() === `${apiUrl}/products` &&
        response.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "Save product" }).click();
    const created = await (await createdResponse).json();
    ids.add(created.id);
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: productName, exact: true }),
    ).toBeVisible();
    await expect(page.locator(".toast")).toContainText(productName);
    await page.getByRole("button", { name: "Dismiss notification" }).click();
    await page
      .getByRole("button", { name: `Edit ${productName}`, exact: true })
      .click();
    await dialog.getByLabel("Stock", { exact: true }).fill("12");
    await dialog.getByRole("button", { name: "Save product" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page
        .getByRole("row")
        .filter({
          has: page.getByRole("button", { name: productName, exact: true }),
        }),
    ).toContainText("In stock");
    await page.getByLabel("Category filter").fill("browser-check");
    await page.getByRole("button", { name: "Filter", exact: true }).click();
    await expect(
      page.getByRole("button", { name: productName, exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "CSV imports", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "CSV imports", exact: true }),
    ).toBeVisible();
    const uploadBox = await page.locator(".dropzone").boundingBox();
    const stagedBox = await page.locator(".staged-file").boundingBox();
    expect(stagedBox!.x).toBeGreaterThan(uploadBox!.x + uploadBox!.width);
    const csv = `name,sku,price,stock,category\n${importName},${importedSku},9.99,10,browser-check\nInvalid row,BAD-${suffix},-1,1,browser-check\n`;
    await page
      .getByLabel("Choose CSV file")
      .setInputFiles({
        name: "browser-check.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csv),
      });
    await expect(
      page.getByText("Ready to import", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Import products", exact: true })
      .click();
    await expect(
      page.getByText("Completed with errors", { exact: true }),
    ).toBeVisible();
    const importedJob = page
      .locator(".import-card")
      .filter({ hasText: "browser-check.csv" });
    await expect(importedJob).toContainText("1 imported");
    await expect(importedJob).toContainText("1 failed");
    await page.screenshot({
      path: "test-results/imports-wide.png",
      fullPage: true,
    });
    await page.reload();
    await expect(
      page.getByText("Completed with errors", { exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Products", exact: true }).click();
    await expect(
      page.getByRole("button", { name: importName, exact: true }),
    ).toBeVisible();
    const list = await (
      await request.get(`${apiUrl}/products?category=browser-check&limit=100`)
    ).json();
    for (const product of list.data)
      if (product.sku === importedSku) ids.add(product.id);
    await page
      .getByRole("button", { name: `Delete ${productName}`, exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Delete product", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: productName, exact: true }),
    ).toHaveCount(0);
    ids.delete(created.id);
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page
      .getByLabel("Password", { exact: true })
      .fill("WrongPassword123!");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.locator(".auth-card .error-message")).toContainText(
      "invalid credentials",
    );
    await page.getByLabel("Password", { exact: true }).fill("BrowserCheck123!");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(/\/products$/);
    await page.evaluate(() =>
      window.dispatchEvent(new Event("session-expired")),
    );
    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByText("Your session expired. Please log in again."),
    ).toBeVisible();
    expect(pageErrors).toEqual([]);
  } finally {
    if (token) {
      const list = await (
        await request.get(`${apiUrl}/products?category=browser-check&limit=100`)
      ).json();
      for (const product of list.data)
        if ([sku, importedSku].includes(product.sku)) ids.add(product.id);
      for (const id of ids)
        await request.delete(`${apiUrl}/products/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
    }
  }
});
