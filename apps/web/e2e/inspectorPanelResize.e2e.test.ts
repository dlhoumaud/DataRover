/**
 * End-to-end browser test for the node inspector panel's drag-to-resize handle: selects a node,
 * drags the handle on the panel's left edge with a real pointer gesture, confirms the panel
 * actually widened by roughly the dragged distance, then reloads the page and confirms the chosen
 * width survived (persisted to localStorage — see useResizableWidth.ts). Runs against the real
 * stack (apps/api + apps/web), same conventions as workflow.e2e.test.ts — see README.md "Tests
 * e2e navigateur".
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Builder, By, Origin, until, type WebDriver } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox";
import { API_URL, WEB_URL, assertReachable } from "./support/env";
import { resolveFirefoxBinary } from "./support/firefox";

const TIMEOUT = 15_000;

async function panelWidth(driver: WebDriver): Promise<number> {
  return driver.executeScript(
    "return document.querySelector(\"aside\")?.offsetWidth ?? 0;",
  ) as Promise<number>;
}

describe("Node inspector panel resize handle", () => {
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

  it("widens the panel by dragging its handle and persists the new width across a reload", async () => {
    const projectName = `E2E resize ${crypto.randomUUID()}`;
    const workflowName = `E2E resize workflow ${crypto.randomUUID()}`;

    // 1. Create a project
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

    // 2. Create a workflow
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
    const editorUrl = await driver.getCurrentUrl();
    await driver.sleep(1000); // let React Flow finish its fitView/layout pass

    // 3. Select the workflow's default node — this is what makes the inspector panel render.
    await driver.wait(until.elementLocated(By.css(".react-flow__node")), TIMEOUT).then((el) => el.click());
    const handle = await driver.wait(
      until.elementLocated(By.css('[role="separator"][aria-label="Redimensionner le panneau"]')),
      TIMEOUT,
    );

    const widthBefore = await panelWidth(driver);
    expect(widthBefore).toBe(320); // DEFAULT_WIDTH in NodeInspectorPanel.tsx, nothing dragged yet

    // 4. Drag the handle 100px to the left — a real pointer gesture, not a synthetic state update.
    // Fresh Actions instance for this one gesture (reusing one across gestures in this suite has
    // previously caused a stale-pointer-state bug — see nodeContextMenu.e2e.test.ts's history).
    await driver
      .actions({ async: true })
      .move({ origin: handle })
      .press()
      .move({ origin: Origin.POINTER, x: -100, y: 0 })
      .release()
      .perform();

    const widthAfterDrag = await panelWidth(driver);
    expect(widthAfterDrag).toBeGreaterThanOrEqual(410);
    expect(widthAfterDrag).toBeLessThanOrEqual(430);

    // 5. Reload from scratch and re-select the node — the width must come back from localStorage,
    // not from in-memory React state.
    await driver.get(editorUrl);
    await driver.wait(until.elementLocated(By.css(".react-flow__node")), TIMEOUT).then((el) => el.click());
    await driver.wait(until.elementLocated(By.css('aside [role="separator"]')), TIMEOUT);

    const widthAfterReload = await panelWidth(driver);
    expect(widthAfterReload).toBe(widthAfterDrag);
  }, 60_000);
});
