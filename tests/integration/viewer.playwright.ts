import { expect, type Page, test } from "@playwright/test";

function selectedDatePanel(page: Page) {
  return page.locator("aside section").filter({ hasText: "Selected date" });
}

function upcomingBusyDaysPanel(page: Page) {
  return page
    .locator("aside section")
    .filter({ hasText: "Upcoming busy days" });
}

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

async function waitForCalendarHydration(page: Page, siteId = "tokyo") {
  await expect(page).toHaveURL(
    new RegExp(`/${siteId}#date=\\d{4}-\\d{2}-\\d{2}$`),
  );
}

test("viewer redirects to the default house and switches between houses", async ({
  page,
}) => {
  await page.goto("/");

  await waitForCalendarHydration(page);
  await expect(
    page.getByRole("heading", { exact: true, name: "Tokyo House" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "House switcher" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { exact: true, name: "Tokyo House" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("View only", { exact: true })).toBeVisible();

  await page.getByRole("link", { exact: true, name: "Taiwan House" }).click();

  await expect(page).toHaveURL(/\/taiwan(?:#date=\d{4}-\d{2}-\d{2})?$/);
  await expect(
    page.getByRole("heading", { exact: true, name: "Taiwan House" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { exact: true, name: "Taiwan House" }),
  ).toHaveAttribute("aria-current", "page");
});

test("selecting an upcoming busy day updates the selected date and hash", async ({
  page,
}) => {
  await page.goto("/tokyo");
  await waitForCalendarHydration(page);

  const initialHash = new URL(page.url()).hash;
  const initialSelectedDate = await selectedDatePanel(page)
    .getByRole("heading")
    .innerText();
  const busyButtons = upcomingBusyDaysPanel(page).getByRole("button");
  await expect(busyButtons.first()).toBeVisible();

  let busyButton = busyButtons.first();
  let selectedDate = "";

  for (let index = 0; index < (await busyButtons.count()); index += 1) {
    const candidateButton = busyButtons.nth(index);
    const candidateDate = firstLine(await candidateButton.innerText());

    if (candidateDate && candidateDate !== initialSelectedDate) {
      busyButton = candidateButton;
      selectedDate = candidateDate;
      break;
    }
  }

  expect(
    selectedDate,
    "expected an upcoming busy day different from the initially selected date",
  ).not.toBe("");

  await busyButton.click();

  await expect(
    selectedDatePanel(page).getByRole("heading", {
      exact: true,
      name: selectedDate,
    }),
  ).toBeVisible();
  await expect.poll(() => new URL(page.url()).hash).not.toBe(initialHash);
  expect(new URL(page.url()).hash).toMatch(/^#date=\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByRole("button", { pressed: true })).toHaveCount(1);
});

test("clicking a calendar day opens the day preview and updates selection", async ({
  page,
}) => {
  await page.goto("/tokyo");
  await waitForCalendarHydration(page);

  const calendarDay = page
    .getByRole("button", { name: /^[A-Z][a-z]+ \d{1,2}, 20\d{2}\. / })
    .first();
  await expect(calendarDay).toBeVisible();

  const ariaLabel = await calendarDay.getAttribute("aria-label");
  const selectedDate = ariaLabel?.match(/^([A-Z][a-z]+ \d{1,2}), 20\d{2}/)?.[1];
  expect(selectedDate).toBeTruthy();

  await calendarDay.click();

  await expect(
    selectedDatePanel(page).getByRole("heading", {
      exact: true,
      name: selectedDate,
    }),
  ).toBeVisible();
  await expect(
    page.locator("div.fixed").filter({
      has: page.getByRole("heading", { exact: true, name: selectedDate }),
    }),
  ).toBeVisible();
});
