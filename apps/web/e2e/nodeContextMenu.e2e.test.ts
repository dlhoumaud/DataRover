/**
 * End-to-end browser test for this iteration's editor additions: the `dataTransform`/`textCrypto`
 * node types (color-coded in the palette, editable in their own inspectors) and the custom
 * right-click context menu (Dupliquer/Supprimer) — React Flow has no built-in one. Same real-stack
 * conventions as workflow.e2e.test.ts — see README.md "Tests e2e navigateur".
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Builder, By, until, type WebDriver } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox";
import { API_URL, WEB_URL, assertReachable } from "./support/env";
import { resolveFirefoxBinary } from "./support/firefox";

const TIMEOUT = 15_000;

describe("node palette colors, new node types, and the node context menu", () => {
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

  it("colors every palette button, builds text/crypto nodes, and supports duplicate/delete via right-click", async () => {
    const projectName = `E2E node-menu ${crypto.randomUUID()}`;
    const workflowName = `E2E node-menu workflow ${crypto.randomUUID()}`;

    // 1. Create a project and workflow
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

    // 2. Every palette button shows a color dot (the same one used on the canvas node)
    const paletteButtons = await driver.findElements(By.css(".flex.flex-wrap.items-center.gap-2 > button"));
    expect(paletteButtons.length).toBeGreaterThanOrEqual(7);
    for (const button of paletteButtons) {
      const dots = await button.findElements(By.css("span.rounded-full"));
      expect(dots.length).toBeGreaterThan(0);
    }

    // 3. Add a "Traitement" (dataTransform) node and edit it in its own inspector
    await driver.findElement(By.xpath("//button[contains(.,'Traitement')]")).click();
    const textNode = await driver.wait(
      until.elementLocated(By.xpath("//*[contains(text(),'New Traitement')]")),
      TIMEOUT,
    );
    await textNode.click();
    const textInputField = await driver.wait(
      until.elementLocated(By.css('input[placeholder="{{ actions.extract1.output.title }}"]')),
      TIMEOUT,
    );
    await textInputField.sendKeys("{{ actions.extract1.output.title }}");
    // Defaults to inputType "raw": the default operation ("trim") should be there, plus its type selector.
    await driver.wait(until.elementLocated(By.xpath("//option[@value='trim']")), TIMEOUT);

    // 4. Add a "Crypto / Encodage" (textCrypto) node and confirm its inspector opens with a hash op
    await driver.findElement(By.xpath("//button[contains(.,'Crypto')]")).click();
    const cryptoNode = await driver.wait(
      until.elementLocated(By.xpath("//*[contains(text(),'New Crypto')]")),
      TIMEOUT,
    );
    await cryptoNode.click();
    await driver.wait(until.elementLocated(By.xpath("//option[@value='sha256']")), TIMEOUT);

    // 5. Add an HTTP node, then exercise the custom right-click context menu on it
    await driver.findElement(By.xpath("//button[contains(.,'HTTP')]")).click();
    await driver.findElement(By.css(".react-flow__controls-fitview")).click();
    await driver.sleep(300);
    const httpNode = await driver.wait(
      until.elementLocated(By.xpath("//*[contains(text(),'New HTTP Request')]")),
      TIMEOUT,
    );

    // A fresh Actions builder per gesture — reusing one across multiple .perform() calls can
    // replay/queue previous pointer state and land the next context-click on the wrong element.
    await driver.actions({ async: true }).contextClick(httpNode).perform();
    const menu = await driver.wait(until.elementLocated(By.css('[role="menu"]')), TIMEOUT);
    const menuItemTexts = await Promise.all(
      (await menu.findElements(By.css('[role="menuitem"]'))).map((el) => el.getText()),
    );
    expect(menuItemTexts).toEqual(["Dupliquer", "Supprimer"]);

    const nodesBeforeDuplicate = (await driver.findElements(By.css(".react-flow__node"))).length;
    await menu.findElement(By.xpath(".//button[contains(.,'Dupliquer')]")).click();
    await driver.wait(async () => {
      const nodes = await driver.findElements(By.css(".react-flow__node"));
      return nodes.length === nodesBeforeDuplicate + 1;
    }, TIMEOUT);
    const duplicateNode = await driver.wait(
      until.elementLocated(By.xpath("//*[contains(text(),'(copie)')]")),
      TIMEOUT,
    );
    expect(await duplicateNode.getText()).toContain("New HTTP Request (copie)");

    // 6. Delete the duplicate via the context menu and confirm only it disappears
    await driver.actions({ async: true }).contextClick(duplicateNode).perform();
    const menu2 = await driver.wait(until.elementLocated(By.css('[role="menu"]')), TIMEOUT);
    await menu2.findElement(By.xpath(".//button[contains(.,'Supprimer')]")).click();
    await driver.wait(async () => {
      const found = await driver.findElements(By.xpath("//*[contains(text(),'(copie)')]"));
      return found.length === 0;
    }, TIMEOUT);
    const remainingNodes = await driver.findElements(By.css(".react-flow__node"));
    expect(remainingNodes.length).toBe(nodesBeforeDuplicate);
    // The original (not the copy) must be the one that survived.
    expect(await driver.findElement(By.xpath("//*[contains(text(),'New HTTP Request')]")).getText()).not.toContain(
      "(copie)",
    );
  }, 60_000);
});
