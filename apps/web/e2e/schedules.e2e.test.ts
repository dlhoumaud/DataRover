/**
 * End-to-end browser test for the scheduler UI (Specs.md §14): opens the "⏱ Planification" panel
 * from the workflow editor, adds an interval schedule, toggles it off/on, adds a cron schedule
 * (first rejecting an invalid expression, then accepting a valid one), and deletes one — each
 * action verified against the real API/Postgres/Redis, not mocked. Runs against the real stack
 * (apps/api + apps/web), same conventions as workflow.e2e.test.ts — see README.md "Tests e2e
 * navigateur".
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Builder, By, until, type WebDriver } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox";
import { API_URL, WEB_URL, assertReachable } from "./support/env";
import { resolveFirefoxBinary } from "./support/firefox";

const TIMEOUT = 15_000;

describe("Scheduler", () => {
  let driver: WebDriver;
  let projectId: string | undefined;

  beforeAll(async () => {
    await assertReachable(WEB_URL, "The web app");
    await assertReachable(`${API_URL}/health`, "The API");

    const options = new firefox.Options()
      .setBinary(resolveFirefoxBinary())
      .addArguments("-headless")
      .windowSize({ width: 1400, height: 950 });
    driver = await new Builder().forBrowser("firefox").setFirefoxOptions(options).build();
  }, 30_000);

  afterAll(async () => {
    if (projectId) {
      await fetch(`${API_URL}/projects/${projectId}`, { method: "DELETE" }).catch(() => undefined);
    }
    await driver?.quit();
  });

  it("adds, toggles, validates, and removes schedules from the real API", async () => {
    const projectName = `E2E schedules ${crypto.randomUUID()}`;
    const workflowName = `E2E schedules workflow ${crypto.randomUUID()}`;

    // 1. Create a project and a workflow
    await driver.get(WEB_URL);
    await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'DataRover')]")), TIMEOUT);
    await driver
      .wait(until.elementLocated(By.xpath("//button[contains(.,'Nouveau projet')]")), TIMEOUT)
      .then((el) => el.click());
    const nameInput = await driver.wait(until.elementLocated(By.css('input[name="name"]')), TIMEOUT);
    await nameInput.sendKeys(projectName);
    await driver.findElement(By.css('button[type="submit"]')).click();
    await driver.wait(until.urlMatches(/\/projects\/[^/]+$/), TIMEOUT);
    const currentUrl = await driver.getCurrentUrl();
    projectId = currentUrl.split("/projects/")[1];
    expect(projectId).toBeTruthy();

    await driver
      .wait(until.elementLocated(By.xpath("//button[contains(.,'Nouveau workflow')]")), TIMEOUT)
      .then((el) => el.click());
    const workflowNameInput = await driver.wait(
      until.elementLocated(By.css('input[type="text"]:not([name="name"]), input[name="name"]')),
      TIMEOUT,
    );
    await workflowNameInput.sendKeys(workflowName);
    await driver.findElement(By.xpath("//button[contains(.,'Créer')]")).click();
    await driver.wait(until.urlMatches(/\/workflows\/[^/]+$/), TIMEOUT);
    await driver.sleep(1000); // let React Flow finish its fitView/layout pass

    // 2. Open the scheduler panel — empty state first.
    await driver
      .wait(until.elementLocated(By.xpath("//button[contains(.,'Planification')]")), TIMEOUT)
      .then((el) => el.click());
    await driver.wait(
      until.elementLocated(By.xpath("//*[contains(.,'Aucune planification')]")),
      TIMEOUT,
    );

    // 3. Add an interval schedule (the default type) — the "Toutes les (minutes)" field only
    // renders for this type, so its presence itself proves the type-dependent form works.
    const minutesInput = await driver.wait(
      until.elementLocated(By.xpath("//label[contains(.,'Toutes les (minutes)')]/following-sibling::input")),
      TIMEOUT,
    );
    await minutesInput.clear();
    await minutesInput.sendKeys("15");
    await driver.findElement(By.xpath("//button[contains(.,'Ajouter')]")).click();
    await driver.wait(
      until.elementLocated(By.xpath("//*[contains(.,'Toutes les 15 minutes')]")),
      TIMEOUT,
    );

    // 4. Toggle it off, then back on — a real PATCH round trip each time.
    const enabledCheckbox = await driver.wait(
      until.elementLocated(By.xpath("//li[contains(.,'Toutes les 15 minutes')]//input[@type='checkbox']")),
      TIMEOUT,
    );
    expect(await enabledCheckbox.isSelected()).toBe(true);
    await enabledCheckbox.click();
    await driver.wait(async () => !(await enabledCheckbox.isSelected()), TIMEOUT);
    await enabledCheckbox.click();
    await driver.wait(async () => enabledCheckbox.isSelected(), TIMEOUT);

    // 5. Switch the type to cron, submit an invalid expression, confirm it's rejected with a
    // visible error and no new row, then correct it and confirm it succeeds.
    const typeSelect = await driver.findElement(By.xpath("//label[contains(.,'Type')]/following-sibling::select"));
    await typeSelect.findElement(By.css('option[value="cron"]')).click();
    const cronInput = await driver.wait(
      until.elementLocated(By.xpath("//label[contains(.,'Expression cron')]/following-sibling::input")),
      TIMEOUT,
    );
    await cronInput.sendKeys("not a cron expression");
    await driver.findElement(By.xpath("//button[contains(.,'Ajouter')]")).click();
    await driver.wait(
      until.elementLocated(By.xpath("//p[contains(@class,'text-red-600')]")),
      TIMEOUT,
    );
    expect(await driver.findElements(By.xpath("//*[contains(.,'Cron :')]"))).toHaveLength(0);

    await cronInput.clear();
    await cronInput.sendKeys("*/5 * * * *");
    await driver.findElement(By.xpath("//button[contains(.,'Ajouter')]")).click();
    await driver.wait(
      until.elementLocated(By.xpath("//*[contains(.,'Cron : */5 * * * *')]")),
      TIMEOUT,
    );

    // 6. Delete the interval schedule; the cron one stays.
    await driver
      .findElement(By.xpath("//li[contains(.,'Toutes les 15 minutes')]//button[contains(.,'supprimer')]"))
      .click();
    await driver.wait(
      async () => (await driver.findElements(By.xpath("//*[contains(.,'Toutes les 15 minutes')]"))).length === 0,
      TIMEOUT,
    );
    // Scoped to `span` (the leaf element `describeSchedule`'s text renders into — see
    // SchedulesPanel.tsx) rather than the generic `//*[contains(.,...)]` used above for pure
    // absence checks: `contains(.,...)` also matches every ANCESTOR whose full text happens to
    // contain the substring, so counting occurrences (not just checking for zero) needs a tag
    // scoped narrowly enough that only the one real leaf node can match.
    expect(await driver.findElements(By.xpath("//span[contains(.,'Cron : */5 * * * *')]"))).toHaveLength(1);

    // 7. Close the panel and reload — the remaining schedule must have really persisted server-side.
    await driver.findElement(By.xpath("//div[contains(@class,'fixed')]//button[contains(.,'Fermer')]")).click();
    await driver.navigate().refresh();
    await driver.sleep(1000);
    await driver
      .wait(until.elementLocated(By.xpath("//button[contains(.,'Planification')]")), TIMEOUT)
      .then((el) => el.click());
    await driver.wait(
      until.elementLocated(By.xpath("//*[contains(.,'Cron : */5 * * * *')]")),
      TIMEOUT,
    );
  }, 60_000);
});
