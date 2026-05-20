import { expect, test } from "@playwright/test";

test("playground generates a dev token and sends a protected request", async ({ page }) => {
  await page.goto("/playground");

  await expect(page.getByRole("heading", { name: "Equipments API Playground" })).toBeVisible();
  await expect(page.getByText("Active Backend")).toBeVisible();

  const bearerToken = page.locator("#bearerToken");
  await expect(bearerToken).toHaveValue("");

  await page.getByLabel("Token rights").selectOption("admin");
  await page.getByRole("button", { name: "Generate Token" }).click();

  await expect(page.locator("#responseCode")).toHaveText("201");
  await expect(page.locator("#responseText")).toHaveText("Token ready");
  await expect(bearerToken).not.toHaveValue("");

  await page.getByRole("button", { name: /List Equipment Types/ }).click();
  await expect(page.locator("#path")).toHaveValue("/equipment-types");
  await expect(page.locator("#requestAuthHint")).toContainText("equipments:read");

  await page.getByRole("button", { name: "Send Request" }).click();

  await expect(page.locator("#responseCode")).toHaveText("200");
  await expect(page.locator("#responseText")).toHaveText("OK");
  await expect(page.locator("#responseBody")).toHaveValue(/"equipmentTypes"/);
  await expect(page.locator("#responseBody")).toHaveValue(/"20FT"/);
});
