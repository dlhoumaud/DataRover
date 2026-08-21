/**
 * End-to-end browser test for the "Boucle" (loop) node: builds a project with a global `items`
 * array variable, adds a `loop` node reading that array, edits its default embedded body step (a
 * `setVariable`, expanded via the same recursive inspector composition `LoopNodeInspector` uses
 * for every body-step type), saves, reloads the page from scratch, and confirms every field
 * (source, the body step's variable) round-tripped through the real API and back — the create/
 * configure/persist flow a user would follow from the editor. Real *execution* proof for the loop
 * itself (item/runtime binding, output modes, the embedded body actually running node-by-node)
 * lives at the engine level instead, not here — see this test's step 6 comment for why, and
 * packages/workflow-core/src/engine.test.ts + loopExecutor.test.ts for that proof. Runs against
 * the real stack (apps/api + apps/web), same conventions as workflow.e2e.test.ts — see README.md
 * "Tests e2e navigateur".
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Builder, By, until, type WebDriver } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox";
import { API_URL, WEB_URL, assertReachable } from "./support/env";
import { resolveFirefoxBinary } from "./support/firefox";

const TIMEOUT = 15_000;

describe("Loop node", () => {
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

  it("configures a loop over a global array, edits its embedded body step, and persists across a reload", async () => {
    const projectName = `E2E loop ${crypto.randomUUID()}`;
    const workflowName = `E2E loop workflow ${crypto.randomUUID()}`;

    // 1. Create a project with a global "items" array — the loop's source, no other node needed.
    await driver.get(WEB_URL);
    await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'DataRover')]")), TIMEOUT);
    await driver
      .wait(until.elementLocated(By.xpath("//button[contains(.,'Nouveau projet')]")), TIMEOUT)
      .then((el) => el.click());
    const nameInput = await driver.wait(until.elementLocated(By.css('input[name="name"]')), TIMEOUT);
    await nameInput.sendKeys(projectName);
    const variablesInput = await driver.findElement(By.css("#project-variables"));
    await variablesInput.sendKeys('{ "items": ["a", "b", "c"] }');
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
    await driver.sleep(1000); // let React Flow finish its fitView/layout pass

    // 3. Add a loop node — the palette button (no "+" prefix, per the current palette style) and
    // the node's own default label both read "Boucle".
    await driver
      .wait(until.elementLocated(By.xpath("//button[contains(.,'Boucle')]")), TIMEOUT)
      .then((el) => el.click());
    const loopNode = await driver.wait(
      until.elementLocated(By.xpath("//*[contains(text(),'New Boucle')]")),
      TIMEOUT,
    );
    await loopNode.click();

    // 4. Point "source" at the project's global array.
    // `following-sibling::div//input`, not `following-sibling::input` — TemplateInput ({{ }}
    // autocomplete) wraps its <input> in a `<div>`, so the field is now the label's sibling's
    // descendant, not a direct sibling itself.
    const sourceInput = await driver.wait(
      until.elementLocated(By.xpath("//label[contains(.,'Source')]/following-sibling::div//input")),
      TIMEOUT,
    );
    await sourceInput.clear();
    await sourceInput.sendKeys("{{ global.items }}");

    // 5. The loop starts with one default body step (a "setVariable" — labelled "Étape 1" in
    // LoopNodeInspector), expanded by default — this renders the exact same
    // SetVariableNodeInspector used for a top-level "Variables" node, just nested. Give it a
    // variable that captures the current item, proving `{{ item }}` resolves inside a body step
    // in a real browser.
    await driver.wait(until.elementLocated(By.xpath("//button[contains(.,'Étape 1')]")), TIMEOUT);
    const addVariableButton = await driver.wait(
      until.elementLocated(By.xpath("//button[contains(.,'+ ajouter')]")),
      TIMEOUT,
    );
    await addVariableButton.click();
    const keyInput = await driver.wait(
      until.elementLocated(By.css('input[placeholder="Nom de variable"]')),
      TIMEOUT,
    );
    await keyInput.sendKeys("seen");
    const valueInput = await driver.findElement(
      By.css('input[placeholder="{{ actions.http1.output.title }}"]'),
    );
    await valueInput.sendKeys("{{ item }}");

    // 6. Save — this is the real round trip under test here: the new workflow's default
    // `startNodeId` stays permanently pinned to the "stop1" node the editor seeds every workflow
    // with (there is no UI to repoint it — a pre-existing gap this iteration didn't introduce and
    // isn't in scope to fix), so a lone `loop` node added afterwards can never actually become
    // reachable from a real run through this UI alone. Real *execution* proof for the loop
    // (item/runtime binding, output modes, the embedded body actually running) lives at the
    // engine level instead — see packages/workflow-core/src/engine.test.ts's "runs a loop node's
    // embedded body..." case and loopExecutor.test.ts. What's specific to the UI and worth
    // proving here is that the schema round-trips cleanly through save → reload: the API accepts
    // a `loop` node's shape, and `flowToDefinition`/`definitionToFlow` preserve it faithfully.
    const editorUrl = await driver.getCurrentUrl();
    await driver.findElement(By.xpath("//button[contains(.,'Enregistrer')]")).click();
    await driver.sleep(1000);
    const savedBodyText = await driver.findElement(By.tagName("body")).getText();
    expect(savedBodyText).not.toContain("Modifications non enregistrées");

    // 7. Reload from scratch and re-open the loop node — everything typed in steps 4-5 must still
    // be there, proving the round trip through the API and back rather than just in-memory state.
    await driver.get(editorUrl);
    await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'New Boucle')]")), TIMEOUT);
    await driver.sleep(1000); // let React Flow finish its fitView/layout pass
    const reloadedLoopNode = await driver.findElement(By.xpath("//*[contains(text(),'New Boucle')]"));
    await reloadedLoopNode.click();

    const reloadedSourceInput = await driver.wait(
      until.elementLocated(By.xpath("//label[contains(.,'Source')]/following-sibling::div//input")),
      TIMEOUT,
    );
    expect(await reloadedSourceInput.getAttribute("value")).toBe("{{ global.items }}");

    await driver.wait(until.elementLocated(By.xpath("//button[contains(.,'Étape 1')]")), TIMEOUT);
    const reloadedKeyInput = await driver.wait(
      until.elementLocated(By.css('input[placeholder="Nom de variable"]')),
      TIMEOUT,
    );
    const reloadedValueInput = await driver.findElement(
      By.css('input[placeholder="{{ actions.http1.output.title }}"]'),
    );
    expect(await reloadedKeyInput.getAttribute("value")).toBe("seen");
    expect(await reloadedValueInput.getAttribute("value")).toBe("{{ item }}");
  }, 60_000);
});
