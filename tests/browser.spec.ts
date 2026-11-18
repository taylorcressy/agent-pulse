import { expect, test } from "@playwright/test";
test("demo navigation and keyboard details", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Demo data", { exact: true })).toBeVisible();
  await expect(page.getByText("Agent allowance")).toBeVisible();
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  await page.getByRole("textbox", { name: "Search sessions" }).fill("atlas");
  const row = page.getByRole("button", { name: /atlas-web/ });
  await row.focus();
  await row.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Usage", exact: true }).click();
  await expect(
    page.getByText("Observed token activity", { exact: true }),
  ).toBeVisible();
});
test("360px overview fits without horizontal scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  await expect(page.getByText("Agent allowance")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
});
