/**
 * End-to-end browser test for the "Prévisualiser & sélectionner" tool (Specs.md §6/§8, extended
 * beyond HTML to JSON/XML): opens an http node's preview against a real local HTTP fixture,
 * clicks a real element in the rendered preview — a sandboxed iframe for HTML, a syntax-
 * highlighted collapsible tree (JsonTreeView) for JSON — picks the resulting candidate selector,
 * validates the rule, and confirms an `extract` node is created and wired from the http node —
 * the full flow a user would follow from the editor. Runs against the real stack (apps/api +
 * apps/worker + apps/web), same conventions as workflow.e2e.test.ts — see README.md "Tests e2e
 * navigateur".
 */
import { createServer } from "node:http";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Builder, By, until, type WebDriver } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox";
import { API_URL, WEB_URL, assertReachable } from "./support/env";
import { resolveFirefoxBinary } from "./support/firefox";

const TIMEOUT = 15_000;

const FIXTURE_HTML = `<!doctype html>
<html>
  <body>
    <div class="product-list">
      <div class="product-card">
        <span class="title" data-testid="title">Produit A</span>
        <span class="price">19.99€</span>
      </div>
      <div class="product-card">
        <span class="title" data-testid="title">Produit B</span>
        <span class="price">29.99€</span>
      </div>
    </div>
  </body>
</html>`;

const FIXTURE_JSON = JSON.stringify({
  items: [
    { title: "Produit A", price: 19.99 },
    { title: "Produit B", price: 29.99 },
  ],
});

/** Starts a loopback fixture server serving one fixed body under a given content-type. */
async function startFixtureServer(body: string, contentType: string): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": contentType });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Fixture server did not bind to a TCP port");
  }
  return { server, url: `http://127.0.0.1:${String(address.port)}/catalog` };
}

describe("Preview & selection tool (HTML/JSON)", () => {
  let driver: WebDriver;
  const projectIds: string[] = [];
  let htmlFixtureServer: Server;
  let htmlFixtureUrl: string;
  let jsonFixtureServer: Server;
  let jsonFixtureUrl: string;

  beforeAll(async () => {
    await assertReachable(WEB_URL, "The web app");
    await assertReachable(`${API_URL}/health`, "The API");

    // The URL entered on the http node is fetched server-side by apps/api (undici), never by the
    // browser — a loopback fixture is reachable from the API process regardless of what the
    // browser itself can reach, same pattern as apps/api/test/tools.e2e.test.ts.
    ({ server: htmlFixtureServer, url: htmlFixtureUrl } = await startFixtureServer(
      FIXTURE_HTML,
      "text/html; charset=utf-8",
    ));
    ({ server: jsonFixtureServer, url: jsonFixtureUrl } = await startFixtureServer(
      FIXTURE_JSON,
      "application/json",
    ));

    const options = new firefox.Options()
      .setBinary(resolveFirefoxBinary())
      .addArguments("-headless")
      .windowSize({ width: 1400, height: 950 });
    driver = await new Builder().forBrowser("firefox").setFirefoxOptions(options).build();
  }, 30_000);

  afterAll(async () => {
    await Promise.all(
      projectIds.map((id) =>
        fetch(`${API_URL}/projects/${id}`, { method: "DELETE" }).catch(() => undefined),
      ),
    );
    await driver?.quit();
    await Promise.all([
      new Promise<void>((resolve, reject) => htmlFixtureServer.close((error) => (error ? reject(error) : resolve()))),
      new Promise<void>((resolve, reject) => jsonFixtureServer.close((error) => (error ? reject(error) : resolve()))),
    ]);
  });

  it("previews a real page, selects a clicked element, and creates a wired extract node", async () => {
    const projectName = `E2E preview ${crypto.randomUUID()}`;
    const workflowName = `E2E preview workflow ${crypto.randomUUID()}`;

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
    const projectId = currentUrl.split("/projects/")[1];
    expect(projectId).toBeTruthy();
    if (projectId) {
      projectIds.push(projectId);
    }

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

    // 3. Add an HTTP node, point it at the fixture, and switch its response type to html
    await driver
      .wait(until.elementLocated(By.xpath("//button[contains(.,'HTTP')]")), TIMEOUT)
      .then((el) => el.click());
    const httpNode = await driver.wait(
      until.elementLocated(By.xpath("//*[contains(text(),'New HTTP Request')]")),
      TIMEOUT,
    );
    await httpNode.click();
    const responseTypeSelect = await driver.wait(
      until.elementLocated(By.css('select[name="responseType"]')),
      TIMEOUT,
    );
    await responseTypeSelect.findElement(By.css('option[value="html"]')).click();
    const urlField = await driver.wait(until.elementLocated(By.css('input[name="url"]')), TIMEOUT);
    await urlField.clear();
    await urlField.sendKeys(htmlFixtureUrl);

    // 4. Open the preview & selection tool
    const previewButton = await driver.wait(
      until.elementLocated(By.xpath("//button[contains(.,'Prévisualiser & sélectionner')]")),
      TIMEOUT,
    );
    await previewButton.click();

    // 5. Wait for the sandboxed iframe to render the real fixture content, then click the first
    // "title" span inside it — a real user gesture against a real (sandboxed) DOM.
    const iframeElement = await driver.wait(
      until.elementLocated(By.css('iframe[title="Aperçu de la page cible"]')),
      TIMEOUT,
    );
    await driver.wait(async () => {
      await driver.switchTo().frame(iframeElement);
      const found = await driver.findElements(By.css('[data-testid="title"]'));
      if (found.length === 0) {
        await driver.switchTo().defaultContent();
        return false;
      }
      return true;
    }, TIMEOUT);
    const targetSpan = await driver.findElement(By.css('[data-testid="title"]'));
    expect(await targetSpan.getText()).toBe("Produit A");
    await targetSpan.click();
    await driver.switchTo().defaultContent();

    // 6. The click posts the candidate selectors to the parent window. Candidates are rendered
    // as editable inputs (not read-only choices — the user can hand-fix or add one), so their
    // current value is read via getAttribute("value") (WebDriver's special-cased, reliable way
    // to read a form element's live value) rather than searched for as text content.
    const sidebar = await driver.findElement(
      By.xpath("//h3[contains(.,'Sélection')]/ancestor::div[contains(@class,'w-96')]"),
    );
    await driver.wait(async () => {
      const inputs = await sidebar.findElements(By.css("input.font-mono"));
      if (inputs.length === 0) {
        return false;
      }
      const values = await Promise.all(inputs.map((input) => input.getAttribute("value")));
      // The exact selector shape called out in Specs.md §6, alongside the `data-testid` one
      // (highest-scored, so the one the backend actually matches on).
      return values.includes(".product-card .title") && values.includes('[data-testid="title"]');
    }, TIMEOUT);

    // "Aperçu du résultat" only renders once some candidate actually matched — wait for it before
    // relying on "Ajouter cette règle" being enabled.
    await driver.wait(until.elementLocated(By.xpath("//pre[contains(.,'Produit A')]")), TIMEOUT);

    // 6b. Candidates are editable, on purpose: hand-break the ".title" one and confirm it gets
    // re-tested automatically (debounced) and flips to "not matched" — while the still-valid
    // `data-testid` candidate keeps the overall preview alive. Locate by current value (not by
    // an `@value=...` XPath predicate — a controlled input's live value lives on the DOM
    // property, not the attribute XPath reads) among elements found by stable structure.
    const candidateInputs = await sidebar.findElements(By.css("input.font-mono"));
    let titleInput;
    for (const input of candidateInputs) {
      if ((await input.getAttribute("value")) === ".title") {
        titleInput = input;
        break;
      }
    }
    if (!titleInput) {
      throw new Error("expected a '.title' candidate among the auto-computed ones");
    }
    await titleInput.clear();
    await titleInput.sendKeys(".this-class-does-not-exist");
    await driver.wait(async () => {
      const badges = await titleInput.findElements(By.xpath("following-sibling::span"));
      if (badges.length === 0) {
        return false;
      }
      return (await badges[0].getText()).trim() === "✕";
    }, TIMEOUT);
    // The data-testid candidate still matches, so the result preview never went away.
    await driver.wait(until.elementLocated(By.xpath("//pre[contains(.,'Produit A')]")), TIMEOUT);

    // 7. Name the rule and validate it
    const ruleNameInput = await driver.wait(
      until.elementLocated(By.xpath("//label[contains(.,'Nom de la règle')]/following-sibling::input")),
      TIMEOUT,
    );
    await ruleNameInput.clear();
    await ruleNameInput.sendKeys("titre");
    await driver.findElement(By.xpath("//button[contains(.,'Ajouter cette règle')]")).click();

    // "Terminer (${count} règle...)" is built from several sibling JSX expressions, so it lands
    // in the DOM as multiple adjacent text nodes — contains(., ...) (string-value of the whole
    // node) matches across them, contains(text(), ...) (a single text-node child) would not.
    await driver.wait(until.elementLocated(By.xpath("//button[contains(.,'Terminer (1')]")), TIMEOUT);
    await driver.findElement(By.xpath("//button[contains(.,'Terminer (1')]")).click();

    // 8. The modal closes and a new extract node, wired from the http node, appears — selecting
    // it shows the rule we just validated in the ExtractNodeInspector.
    await driver.wait(
      until.elementLocated(By.xpath("//*[contains(.,'New Extraction')]")),
      TIMEOUT,
    );
    const extractNode = await driver.findElement(By.xpath("//*[contains(.,'New Extraction')]"));
    await extractNode.click();
    // ExtractNodeInspector's selector field is react-hook-form-registered (uncontrolled): its
    // live value lives on the DOM property, not the `value` attribute, so it must be read via
    // getAttribute("value") (which WebDriver special-cases to the current property for form
    // elements) rather than located by an `@value=...` XPath predicate against the raw attribute.
    const selectorValueInput = await driver.wait(
      until.elementLocated(By.css("input.font-mono")),
      TIMEOUT,
    );
    expect(await selectorValueInput.getAttribute("value")).toBe('[data-testid="title"]');

    // 9. Save — confirms the new node/edge round-trip cleanly through flowToDefinition and the API.
    await driver.findElement(By.xpath("//button[contains(.,'Enregistrer')]")).click();
    await driver.sleep(500);
    const bodyText = await driver.findElement(By.tagName("body")).getText();
    expect(bodyText).not.toContain("Modifications non enregistrées");
  }, 60_000);

  it("previews a real JSON response as a collapsible tree, selects a clicked value, and creates a wired extract node with a JSONPath rule", async () => {
    const projectName = `E2E preview json ${crypto.randomUUID()}`;
    const workflowName = `E2E preview json workflow ${crypto.randomUUID()}`;

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
    const projectId = currentUrl.split("/projects/")[1];
    expect(projectId).toBeTruthy();
    if (projectId) {
      projectIds.push(projectId);
    }

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

    // 3. Add an HTTP node and point it at the JSON fixture — "json" is already the default
    // responseType (see createDefaultNode), so no select change is needed here.
    await driver
      .wait(until.elementLocated(By.xpath("//button[contains(.,'HTTP')]")), TIMEOUT)
      .then((el) => el.click());
    const httpNode = await driver.wait(
      until.elementLocated(By.xpath("//*[contains(text(),'New HTTP Request')]")),
      TIMEOUT,
    );
    await httpNode.click();
    const urlField = await driver.wait(until.elementLocated(By.css('input[name="url"]')), TIMEOUT);
    await urlField.clear();
    await urlField.sendKeys(jsonFixtureUrl);

    // 4. Open the preview tool — for non-HTML the button reads "Prévisualiser" (no "sélectionner
    // un élément" suffix, since it doubles as a plain read-only viewer for text/file too).
    const previewButton = await driver.wait(
      until.elementLocated(By.xpath("//button[contains(.,'Prévisualiser')]")),
      TIMEOUT,
    );
    await previewButton.click();

    // 5. Wait for the collapsible JSON tree to render the real fixture content. `items` (an
    // array one level below the root) is auto-expanded, but its own entries — the two product
    // objects, two levels below the root — start collapsed ("replis"), so the first product's
    // fields aren't on screen yet: expand it via its own toggle before clicking into it.
    await driver.wait(until.elementLocated(By.xpath("//span[text()='\"items\"']")), TIMEOUT);
    const expandButtons = await driver.wait(async () => {
      const buttons = await driver.findElements(By.xpath("//button[@aria-label='Développer']"));
      return buttons.length > 0 ? buttons : null;
    }, TIMEOUT);
    const firstExpandButton = expandButtons?.[0];
    if (!firstExpandButton) {
      throw new Error("expected at least one collapsed ('Développer') toggle button");
    }
    await firstExpandButton.click();

    // 6. Click the first product's real (now-visible) "price" leaf — a real user gesture against
    // a real, syntax-highlighted tree, not a mock.
    const priceLeaf = await driver.wait(until.elementLocated(By.xpath("//span[text()='19.99']")), TIMEOUT);
    await priceLeaf.click();

    // 7. The click computed a single canonical JSONPath candidate (unlike HTML's several scored
    // CSS candidates) — shown as an editable input, same as the HTML flow.
    const sidebar = await driver.findElement(
      By.xpath("//h3[contains(.,'Sélection')]/ancestor::div[contains(@class,'w-96')]"),
    );
    await driver.wait(async () => {
      const inputs = await sidebar.findElements(By.css("input.font-mono"));
      if (inputs.length === 0) {
        return false;
      }
      const values = await Promise.all(inputs.map((input) => input.getAttribute("value")));
      return values.includes("$.items[0].price");
    }, TIMEOUT);
    // "Aperçu du résultat" only renders once the selector actually matched.
    await driver.wait(until.elementLocated(By.xpath("//pre[contains(.,'19.99')]")), TIMEOUT);

    // 8. Name the rule and validate it
    const ruleNameInput = await driver.wait(
      until.elementLocated(By.xpath("//label[contains(.,'Nom de la règle')]/following-sibling::input")),
      TIMEOUT,
    );
    await ruleNameInput.clear();
    await ruleNameInput.sendKeys("prix");
    await driver.findElement(By.xpath("//button[contains(.,'Ajouter cette règle')]")).click();
    await driver.wait(until.elementLocated(By.xpath("//button[contains(.,'Terminer (1')]")), TIMEOUT);
    await driver.findElement(By.xpath("//button[contains(.,'Terminer (1')]")).click();

    // 9. The modal closes and a new extract node, tagged sourceType "json" and wired from the
    // http node, appears — selecting it shows the JSONPath rule we just validated.
    await driver.wait(until.elementLocated(By.xpath("//*[contains(.,'New Extraction')]")), TIMEOUT);
    const extractNode = await driver.findElement(By.xpath("//*[contains(.,'New Extraction')]"));
    await extractNode.click();
    const sourceTypeSelect = await driver.wait(
      until.elementLocated(By.css('select[name="sourceType"]')),
      TIMEOUT,
    );
    expect(await sourceTypeSelect.getAttribute("value")).toBe("json");
    const selectorValueInput = await driver.wait(
      until.elementLocated(By.css("input.font-mono")),
      TIMEOUT,
    );
    expect(await selectorValueInput.getAttribute("value")).toBe("$.items[0].price");

    // 10. Save — confirms the new node/edge round-trip cleanly through flowToDefinition and the API.
    await driver.findElement(By.xpath("//button[contains(.,'Enregistrer')]")).click();
    await driver.sleep(500);
    const bodyText = await driver.findElement(By.tagName("body")).getText();
    expect(bodyText).not.toContain("Modifications non enregistrées");
  }, 60_000);
});
