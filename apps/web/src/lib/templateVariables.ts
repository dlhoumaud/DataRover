import type { ActionNode } from "@datarover/workflow-types";

/** One `{{ }}`-usable reference offered by the autocomplete dropdown / shown in the node
 *  inspector's "Variable(s) de sortie" display. `path` is what actually gets inserted between
 *  `{{ }}`; `label` is what the dropdown row shows (currently always the same as `path` — kept
 *  distinct in case a friendlier label is worth adding later without touching every call site). */
export interface TemplateVariable {
  path: string;
  label: string;
}

/**
 * Sub-fields of a node's `output` that are statically knowable from its type (and, for
 * `extract`, from the node's own configured rule names) — mirrors each executor's actual return
 * shape in `packages/workflow-core/src/executors/*.ts`. `[]` means nothing further is known
 * statically (a bare scalar, e.g. `textCrypto`'s hashed string — or a shape too dynamic to
 * enumerate, e.g. `dataTransform`'s `"table"` rows, whose column names aren't known until the
 * data itself is): `actions.<id>.output` alone is still offered for those, just with no
 * drilled-down siblings.
 *
 * `setVariable` is deliberately absent here — see `getNodeOutputVariables`'s own doc comment for
 * why it's special-cased entirely rather than routed through this function.
 */
function getOutputSubPaths(node: ActionNode): string[] {
  switch (node.type) {
    case "http":
      return ["status", "headers", "body"];
    case "browserAction":
      return ["status", "html"];
    case "extract":
      return node.rules.map((rule) => rule.name);
    case "stop":
      return ["stopped", "reason"];
    case "condition":
    case "dataTransform":
    case "textCrypto":
    case "loop":
    case "setVariable":
      return [];
    default: {
      const exhaustiveCheck: never = node;
      throw new Error(`Unsupported node type: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

/**
 * Every `{{ }}`-usable reference a single node contributes once it has run. Shown both in
 * `NodeInspectorPanel`'s "Variable(s) de sortie" display (for that node itself) and as
 * autocomplete entries offered to every *other* node in the graph (via `getAvailableVariables`).
 *
 * `setVariable` is special-cased to `workflow.<key>` — what a downstream node is actually meant
 * to reference (see `setVariableExecutor.ts`: every key gets written to `ctx.variables.workflow`)
 * — rather than the generic `actions.<id>.output.<key>` every other type gets. The latter would
 * also technically resolve (the executor's own returned `output` happens to contain the same
 * keys), but `workflow.<key>` is the one convention this whole codebase's placeholders/docs
 * already use, so it's the only one offered here to avoid suggesting two equally-valid-looking
 * but inconsistent ways to read the same value.
 */
export function getNodeOutputVariables(node: ActionNode): TemplateVariable[] {
  if (node.type === "setVariable") {
    return Object.keys(node.variables).map((key) => ({
      path: `workflow.${key}`,
      label: `workflow.${key}`,
    }));
  }

  const base = `actions.${node.id}.output`;
  const variables: TemplateVariable[] = [{ path: base, label: base }];
  for (const subPath of getOutputSubPaths(node)) {
    variables.push({ path: `${base}.${subPath}`, label: `${base}.${subPath}` });
  }
  return variables;
}

/**
 * Every variable available for `{{ }}` autocomplete at some point while editing a workflow:
 * every other node's output (see `getNodeOutputVariables`), every declared project-level global
 * variable, and — only inside a `loop` node's embedded body — the current-iteration bindings
 * (`item`, `runtime.*`) that only exist there (see `LoopNodeSchema`'s doc comment in
 * `@datarover/workflow-types`).
 *
 * Deliberately offers every node in the graph, not just ones topologically before the field being
 * edited: the editor lets nodes be added/wired in any order, and a forward reference is a
 * config mistake worth flagging at *run* time (the engine already does, via a plain "undefined"
 * value), not something worth silently hiding from autocomplete while the graph is still being
 * built.
 */
export function getAvailableVariables(params: {
  nodes: readonly ActionNode[];
  currentNodeId?: string;
  globalVariableKeys?: readonly string[];
  insideLoopBody?: boolean;
}): TemplateVariable[] {
  const variables: TemplateVariable[] = [];

  for (const node of params.nodes) {
    if (node.id === params.currentNodeId) {
      continue;
    }
    variables.push(...getNodeOutputVariables(node));
  }

  for (const key of params.globalVariableKeys ?? []) {
    variables.push({ path: `global.${key}`, label: `global.${key}` });
  }

  if (params.insideLoopBody) {
    variables.push(
      { path: "item", label: "item" },
      { path: "runtime.index", label: "runtime.index" },
      { path: "runtime.isFirst", label: "runtime.isFirst" },
      { path: "runtime.isLast", label: "runtime.isLast" },
    );
  }

  return variables;
}

/**
 * The in-progress query text if `cursorIndex` sits inside an unclosed `{{ }}` block (e.g. `"foo
 * {{ glob"` with the cursor at the end returns `"glob"`), or `null` if it doesn't — the trigger
 * condition `TemplateInput` uses to decide whether to show its autocomplete dropdown at all.
 * `""` (just typed `{{`) is a valid, non-null result: it means "show every variable, unfiltered".
 */
export function extractTemplateQuery(value: string, cursorIndex: number): string | null {
  const upToCursor = value.slice(0, cursorIndex);
  const lastOpen = upToCursor.lastIndexOf("{{");
  if (lastOpen === -1) {
    return null;
  }
  const between = upToCursor.slice(lastOpen + 2);
  if (between.includes("}}")) {
    return null;
  }
  return between.trimStart();
}

/**
 * Replaces the currently-open `{{ ... ` block (from its `{{` up to `cursorIndex`) with
 * `{{ path }}`, returning the new full value and where the cursor should land right after.
 * Precondition: `extractTemplateQuery(value, cursorIndex)` returned non-null for the same
 * `value`/`cursorIndex` — this never re-derives that itself, so calling it when no block is open
 * throws rather than silently mangling unrelated text.
 */
export function insertTemplateVariable(
  value: string,
  cursorIndex: number,
  path: string,
): { value: string; cursor: number } {
  const upToCursor = value.slice(0, cursorIndex);
  const lastOpen = upToCursor.lastIndexOf("{{");
  if (lastOpen === -1) {
    throw new Error("insertTemplateVariable called without an open {{ block before cursorIndex");
  }
  const before = value.slice(0, lastOpen + 2);
  const after = value.slice(cursorIndex);
  const inserted = ` ${path} }}`;
  return { value: `${before}${inserted}${after}`, cursor: before.length + inserted.length };
}
