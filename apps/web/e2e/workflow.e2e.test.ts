/**
 * End-to-end browser test: drives the real stack (apps/api + apps/worker + apps/web, all
 * expected to already be running against a real Postgres/Redis — see README.md "Tests e2e
 * navigateur") through the same walkthrough used to manually verify iteration 3: create a
 * project, create a workflow, add an HTTP node via the palette, edit it in the inspector, save,
 * run it, and confirm the execution reaches "success" with a visible log.
 *
 * Runs against a real, unpatched Firefox via selenium-webdriver + geckodriver (Playwright's
 * bundled Chromium needs `sudo apt-get`-installed system libraries that aren't available in
 * every environment this repo is developed in; stock Firefox plus the W3C WebDriver protocol
 * needs neither).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Builder, By, until, type WebDriver } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox";
import { API_URL, WEB_URL, assertReachable } from "./support/env";
import { resolveFirefoxBinary } from "./support/firefox";

const TIMEOUT = 15_000;

describe("workflow walkthrough", () => {
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
      // Cascade-deletes the workflow/executions/logs created by this test (see
      // packages/database/prisma/schema.prisma onDelete: Cascade).
      await fetch(`${API_URL}/projects/${projectId}`, { method: "DELETE" }).catch(() => undefined);
    }
    await driver?.quit();
  });

  it("creates a project, builds a workflow, runs it, and reaches success", async () => {
    const projectName = `E2E ${crypto.randomUUID()}`;
    const workflowName = `E2E workflow ${crypto.randomUUID()}`;

    // 1. Home page
    await driver.get(WEB_URL);
    await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'DataRover')]")), TIMEOUT);

    // 2. Create a project
    await driver.wait(
      until.elementLocated(By.xpath("//button[contains(.,'Nouveau projet')]")),
      TIMEOUT,
    ).then((el) => el.click());
    const nameInput = await driver.wait(until.elementLocated(By.css('input[name="name"]')), TIMEOUT);
    await nameInput.sendKeys(projectName);
    await driver.findElement(By.css('button[type="submit"]')).click();

    await driver.wait(until.urlMatches(/\/projects\/[^/]+$/), TIMEOUT);
    await driver.wait(until.elementLocated(By.xpath(`//*[contains(text(),'${projectName}')]`)), TIMEOUT);
    const currentUrl = await driver.getCurrentUrl();
    projectId = currentUrl.split("/projects/")[1];
    expect(projectId).toBeTruthy();

    // 3. Create a workflow
    await driver.wait(
      until.elementLocated(By.xpath("//button[contains(.,'Nouveau workflow')]")),
      TIMEOUT,
    ).then((el) => el.click());
    const workflowNameInput = await driver.wait(
      until.elementLocated(By.css('input[type="text"]:not([name="name"]), input[name="name"]')),
      TIMEOUT,
    );
    await workflowNameInput.sendKeys(workflowName);
    await driver.findElement(By.xpath("//button[contains(.,'Créer')]")).click();

    await driver.wait(until.urlMatches(/\/workflows\/[^/]+$/), TIMEOUT);
    await driver.sleep(1000); // let React Flow finish its fitView/layout pass

    // 4. Add an HTTP node via the palette and open its inspector
    await driver.wait(until.elementLocated(By.xpath("//button[contains(.,'HTTP')]")), TIMEOUT).then((el) =>
      el.click(),
    );
    const httpNode = await driver.wait(
      until.elementLocated(By.xpath("//*[contains(text(),'New HTTP Request')]")),
      TIMEOUT,
    );
    await httpNode.click();
    const urlField = await driver.wait(until.elementLocated(By.css('input[name="url"]')), TIMEOUT);
    await urlField.clear();
    await urlField.sendKeys("{{ global.baseUrl }}/products");

    // 5. Save
    await driver.findElement(By.xpath("//button[contains(.,'Enregistrer')]")).click();
    await driver.sleep(1000);

    // 6. Run — the single-node "Stop" branch this workflow starts on needs no network call, so
    // the execution is expected to reach "success" without any external fixture server.
    await driver.findElement(By.xpath("//button[contains(.,'Exécuter')]")).click();
    await driver.wait(until.urlMatches(/\/executions\/[^/]+$/), TIMEOUT);

    // 7. Poll the execution detail page (the app itself polls the API every second) until it
    // reaches a final status.
    await driver.wait(
      async () => {
        const text = await driver.findElement(By.tagName("body")).getText();
        return text.includes("Succès") || text.includes("Échec");
      },
      20_000,
      "execution never reached a final status",
    );

    const bodyText = await driver.findElement(By.tagName("body")).getText();
    expect(bodyText).toContain("Succès");
    expect(bodyText).toContain("Journal d'exécution");
  }, 60_000);
});
