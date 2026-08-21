/**
 * End-to-end browser test for the `{{ }}` autocomplete (TemplateInput / lib/templateVariables.ts):
 * typing `{{` inside a templated field shows a dropdown of available variables (here, another
 * node's own output), and picking one inserts it wrapped in `{{ }}`. Same real-stack conventions
 * as workflow.e2e.test.ts — see README.md "Tests e2e navigateur".
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Builder, By, until, type WebDriver } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox";
import { API_URL, WEB_URL, assertReachable } from "./support/env";
import { resolveFirefoxBinary } from "./support/firefox";

const TIMEOUT = 15_000;

describe("{{ }} autocomplete", () => {
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

  it("shows another node's output as a suggestion and inserts it wrapped in {{ }}", async () => {
    const projectName = `E2E autocomplete ${crypto.randomUUID()}`;
    const workflowName = `E2E autocomplete workflow ${crypto.randomUUID()}`;

    // 1. Create a project and workflow.
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

    // 2. Add a "Variables" (setVariable) node and name one variable "count" — its
    // workflow.count reference is what the HTTP node's URL field below should suggest.
    await driver.findElement(By.xpath("//button[contains(.,'Variables')]")).click();
    const setVariableNode = await driver.wait(
      until.elementLocated(By.xpath("//*[contains(text(),'New Variables')]")),
      TIMEOUT,
    );
    await setVariableNode.click();
    await driver.findElement(By.xpath("//button[contains(.,'ajouter')]")).click();
    const keyInput = await driver.wait(
      until.elementLocated(By.css('input[placeholder="Nom de variable"]')),
      TIMEOUT,
    );
    await keyInput.sendKeys("count");
    const valueInput = await driver.findElement(
      By.xpath("//input[@placeholder='{{ actions.http1.output.title }}']"),
    );
    await valueInput.sendKeys("3");

    // 3. Add an HTTP node and check its "Variable(s) de sortie" panel shows its own output refs
    // (the feature's other half — shown once, in the shared panel header, for every node type).
    await driver.findElement(By.xpath("//button[contains(.,'HTTP')]")).click();
    await driver.findElement(By.css(".react-flow__controls-fitview")).click();
    await driver.sleep(300);
    const httpNode = await driver.wait(
      until.elementLocated(By.xpath("//*[contains(text(),'New HTTP Request')]")),
      TIMEOUT,
    );
    await httpNode.click();
    // "Variable(s) de sortie" — plural for http (4 known sub-fields: base + status/headers/body).
    await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'de sortie')]")), TIMEOUT);
    await driver.wait(
      until.elementLocated(By.xpath("//*[contains(text(),'{{ actions.http1.output.status }}')]")),
      TIMEOUT,
    );

    // 4. Type `{{` into the URL field — a dropdown should appear listing workflow.count.
    const urlInput = await driver.wait(until.elementLocated(By.css('input[name="url"]')), TIMEOUT);
    await urlInput.sendKeys("{{ coun");
    const suggestion = await driver.wait(
      until.elementLocated(By.xpath("//*[@role='option'][contains(.,'workflow.count')]")),
      TIMEOUT,
    );

    // 5. Clicking it inserts the reference wrapped in {{ }}.
    await suggestion.click();
    await driver.wait(async () => (await urlInput.getAttribute("value")) === "{{ workflow.count }}", TIMEOUT);
  }, 60_000);
});
