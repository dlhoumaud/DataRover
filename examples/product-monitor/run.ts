/**
 * Runnable example: "Surveillance catalogue" (cahier des charges, section 3),
 * replayed against the real `@datarover/workflow-core` engine.
 *
 * Scope note (read before touching the workflow): section 3's diagram
 * describes six steps, the last two of which are NOT implemented by the
 * engine shipped in this MVP:
 *
 *   Action 3: FOR EACH produit   -> loop/iteration executor, planned V2
 *   Action 6: Notification       -> webhook/API/storage "output" executor,
 *                                    not part of the default registry either
 *
 * `WorkflowEngine`'s default executor registry only covers `http`,
 * `extract`, `condition`, `setVariable`, and `stop` (see
 * packages/workflow-core/src/engine.ts). This example therefore replays the
 * MVP-sized subset that those five executors actually support:
 *
 *   GET /products (http, responseType "html")
 *     -> Extract product titles + prices (extract, CSS, output "list")
 *       -> IF first product's price < target price (condition)
 *         -> stop("price dropped")   [true branch]
 *         -> stop("price stable")    [false branch]
 *
 * The two `stop` nodes stand in for what section 3 calls "Action 6:
 * Notification": sending a real webhook/email is an output action that does
 * not exist yet, so this example just records *why* the workflow stopped
 * and leaves the reader to imagine the notification wired on top of it.
 *
 * Numeric-comparison note: section 6 of the cahier des charges shows prices
 * formatted as "29.99 €". The engine has no "parse number"/"format"
 * transform executor yet (those are listed as V2 "Actions de
 * transformation" in section 9.4), and `extractWithCss`'s "list" output is
 * always the raw trimmed text of the matched elements (see
 * packages/extractor/src/html/cssExtractor.ts) - so a currency-suffixed
 * string like "29.99 €" would make `checkPriceDrop`'s numeric comparison
 * evaluate to `NaN < NaN`, i.e. always `false`. To keep this example
 * self-contained and actually functional without inventing a transform
 * node the engine doesn't have, the fixture HTML below serves plain
 * numeric price text (no "€"). A real deployment would insert a "Format"
 * transform action between `extractProducts` and `checkPriceDrop` once V2
 * ships that executor.
 */

import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { WorkflowEngine } from "@datarover/workflow-core";
import type { ExecutionEvent } from "@datarover/workflow-core";
import { WorkflowDefinitionSchema } from "@datarover/workflow-types";
import type { WorkflowDefinition } from "@datarover/workflow-types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Fixture HTML served at `GET /products`, matching the structure shown in
 * section 6 of the cahier des charges (`.product-card` > `.title` +
 * `.price`), with plain numeric prices (see the module doc comment above
 * for why the "€" suffix is dropped here). The first card is priced below
 * the `targetPrice` the workflow is given, so the run below is expected to
 * take the "price dropped" branch.
 */
const PRODUCTS_HTML = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <title>Catalogue - Boutique Demo</title>
  </head>
  <body>
    <main>
      <h1>Catalogue</h1>
      <div class="product-card">
        <span class="title">Produit A</span>
        <span class="price">24.99</span>
      </div>
      <div class="product-card">
        <span class="title">Produit B</span>
        <span class="price">45.50</span>
      </div>
      <div class="product-card">
        <span class="title">Produit C</span>
        <span class="price">12.00</span>
      </div>
    </main>
  </body>
</html>
`;

/** The target price the workflow monitors the first product against. */
const TARGET_PRICE = 30;

/** Zero-padded local `[HH:MM:SS]` timestamp, matching the cahier des charges' section 15 console example. */
function timestamp(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `[${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}]`;
}

/** Prints one transcript line prefixed with the current local time. */
function logLine(message: string): void {
  console.log(`${timestamp()} ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/** `true` when `value` looks like an `http` node's `{ status, headers, body }` output. */
function isHttpOutput(value: unknown): value is { status: unknown } {
  return isRecord(value) && "status" in value && "headers" in value && "body" in value;
}

/** `true` when `value` looks like a `stop` node's `{ stopped, reason }` output. */
function isStopOutput(value: unknown): value is { stopped: boolean; reason?: string } {
  return isRecord(value) && typeof value["stopped"] === "boolean";
}

/**
 * Turns a node's raw `action-completed` output into a short, human-readable
 * summary line, in the spirit of section 15's illustrative console log
 * (`"HTTP 200"`, `"42 items extracted"`, ...).
 */
function describeOutput(nodeId: string, output: unknown): string {
  if (isHttpOutput(output)) {
    return `HTTP ${String(output.status)}`;
  }

  if (nodeId === "extractProducts" && isRecord(output)) {
    const titles = isStringArray(output["titles"]) ? output["titles"] : [];
    const prices = isStringArray(output["prices"]) ? output["prices"] : [];
    return `${String(titles.length)} produit(s) extrait(s) - prix: [${prices.join(", ")}]`;
  }

  if (nodeId === "checkPriceDrop") {
    return `Condition evaluee a ${String(output)}`;
  }

  if (isStopOutput(output)) {
    return `Stop - ${output.reason ?? "(sans raison)"}`;
  }

  return JSON.stringify(output);
}

/** Formats one `ExecutionEvent` as a `[HH:MM:SS] message` transcript line and prints it. */
function printEvent(event: ExecutionEvent): void {
  switch (event.type) {
    case "started":
      logLine(`Workflow started (execution ${event.executionId})`);
      break;
    case "action-started":
      logLine(`-> ${event.nodeName}`);
      break;
    case "action-completed":
      logLine(`   ${describeOutput(event.nodeId, event.output)} (${String(event.durationMs)}ms)`);
      break;
    case "action-failed":
      logLine(`   FAILED: ${event.error}`);
      break;
    case "completed":
      logLine(`Workflow ${event.status} (${String(event.durationMs)}ms)`);
      break;
  }
}

/** Starts the local fixture HTTP server on an ephemeral port and resolves once it is listening. */
async function startFixtureServer(): Promise<{ server: Server; port: number }> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "GET" && req.url === "/products") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(PRODUCTS_HTML);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Fixture server did not bind to a TCP port"));
        return;
      }
      resolve({ server, port: address.port });
    });
  });
}

/** Loads and validates `workflow.json` (next to this file) against the real Zod schema. */
async function loadWorkflowDefinition(): Promise<WorkflowDefinition> {
  const filePath = path.join(__dirname, "workflow.json");
  const raw = await readFile(filePath, "utf-8");
  const parsed: unknown = JSON.parse(raw);
  return WorkflowDefinitionSchema.parse(parsed);
}

async function main(): Promise<number> {
  const { server, port } = await startFixtureServer();

  try {
    const definition = await loadWorkflowDefinition();
    const engine = new WorkflowEngine();

    console.log(`Fixture server listening on http://localhost:${String(port)}`);
    console.log(`Target price: ${String(TARGET_PRICE)}`);
    console.log("");

    const execution = await engine.run(definition, {
      variables: {
        global: {
          baseUrl: `http://localhost:${String(port)}`,
          targetPrice: TARGET_PRICE,
        },
      },
      onEvent: printEvent,
      // The engine's default logger would otherwise also print every step
      // to the console (prefixed with "[workflow-engine]"), duplicating the
      // onEvent-driven transcript above. A silent logger keeps this
      // example's output limited to the section-15-style transcript.
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
      },
    });

    console.log("");
    console.log(`Final status: ${execution.status}`);
    if (execution.error !== undefined) {
      console.log(`Error: ${execution.error}`);
    }

    console.log("");
    console.log("Action results:");
    for (const result of execution.actionResults) {
      console.log(
        `  - ${result.nodeId}: ${result.status} (attempts=${String(result.attempts)})` +
          (result.error !== undefined ? ` error=${result.error}` : ""),
      );
    }

    return execution.status === "success" ? 0 : 1;
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}

main()
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((error: unknown) => {
    console.error("Example crashed:", error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
  });
