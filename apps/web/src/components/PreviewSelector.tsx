import { useEffect, useMemo, useRef, useState } from "react";
import { XMLParser } from "fast-xml-parser";
import type {
  ExtractionRule,
  ExtractOutputType,
  ExtractSourceType,
  HttpMethod,
  HttpNode,
} from "@datarover/workflow-types";
import { usePreviewHtml, useTestSelector } from "../api/tools";
import { buildSandboxedDocument, isElementSelectedMessage } from "../lib/htmlSandbox";
import { buildJsonPath } from "../lib/jsonPath";
import { JsonTreeView } from "./JsonTreeView";
import type { SelectorScoreDto } from "../api/types";

/** Waited out after every keystroke in a candidate field before re-testing it against the API. */
const EDIT_DEBOUNCE_MS = 400;

/**
 * Same attribute-prefix convention used everywhere else parsed XML flows through this app
 * (`packages/extractor`'s xmlExtractor, `dataTransformExecutor`) — kept identical here purely for
 * the client-side tree *display*; the actual extraction always re-parses the raw XML text
 * server-side (see runSelectorTest below), so a mismatch here could never silently break a rule,
 * only make the tree's own on-screen keys inconsistent with what jsonpath-plus would report.
 */
const XML_PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: "attr_",
  textNodeName: "#text",
  trimValues: true,
  parseTagValue: true,
  parseAttributeValue: true,
};

/**
 * Response types the preview tool can render as a structured, clickable surface. "text" still
 * gets a readable (but non-selectable — there's no structure to click into) preview; "file" has no
 * button to open this at all (see HttpNodeInspector).
 */
function sourceTypeFor(responseType: HttpNode["responseType"]): ExtractSourceType | null {
  if (responseType === "html" || responseType === "json" || responseType === "xml") {
    return responseType;
  }
  return null;
}

/**
 * The "Prévisualiser & sélectionner" tool (Specs.md §6/§8, extended beyond HTML to JSON/XML):
 * fetches the target http node's response and renders it as a structured, clickable surface —
 * a sandboxed iframe for HTML (see htmlSandbox.ts for the security model: no script from the
 * fetched page ever runs) or a syntax-highlighted collapsible tree for JSON/XML (JsonTreeView,
 * which needs no sandboxing at all since it only ever renders plain data as React text, never
 * markup from the target site). Clicking an element/node computes selector candidates — CSS
 * selectors with a robustness score for HTML, a single canonical JSONPath for JSON/XML — shown as
 * **editable** fields so the user can hand-fix or add a fallback selector and see it re-scored
 * live. Validated rules accumulate until "Terminer" hands them all to the caller at once, along
 * with the `sourceType` the caller needs to tag the new `extract` node with.
 */
export function PreviewSelector({
  projectId,
  method,
  url,
  headers,
  queryParams,
  body,
  responseType,
  onClose,
  onValidate,
}: {
  projectId: string;
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  body?: unknown;
  responseType: HttpNode["responseType"];
  onClose: () => void;
  onValidate: (rules: ExtractionRule[], sourceType: ExtractSourceType) => void;
}): JSX.Element {
  const sourceType = sourceTypeFor(responseType);
  const canSelect = sourceType !== null;

  const preview = usePreviewHtml();
  const testSelector = useTestSelector();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [accumulatedRules, setAccumulatedRules] = useState<ExtractionRule[]>([]);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [selectedPathKey, setSelectedPathKey] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [ruleName, setRuleName] = useState("");
  const [output, setOutput] = useState<ExtractOutputType>(sourceType === "html" ? "text" : "value");
  const [attribute, setAttribute] = useState("");
  // Off by default (fast path — a plain fetch): only meaningful for targets whose real content
  // only exists after client-side JS runs (a SPA shell with no server-rendered markup — verified
  // against a real reported page with no <h1> anywhere in its plain-fetched HTML). Toggling it
  // re-fetches via a real headless browser server-side instead (BrowserRendererService) — slower,
  // and GET-only, so it's an explicit opt-in rather than the default for every preview. Only
  // meaningful for HTML — JSON/XML APIs don't have a client-side rendering step to wait out.
  const [render, setRender] = useState(false);

  useEffect(() => {
    preview.mutate({ projectId, method, url, headers, queryParams, body, render });
    setSelectedLabel(null);
    setSelectedPathKey(null);
    setCandidates([]);
    // Intentionally re-runs only when the http node's own request shape (or the render toggle)
    // changes, not on every re-render (preview/testSelector are mutation objects that change
    // identity each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, method, url, headers, queryParams, body, render]);

  useEffect(
    () => () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    },
    [],
  );

  const sandboxedDocument = useMemo(() => {
    if (!preview.data || sourceType !== "html") {
      return null;
    }
    return buildSandboxedDocument(preview.data.html, preview.data.url);
  }, [preview.data, sourceType]);

  const parsedData = useMemo((): { value: unknown } | { error: string } | null => {
    if (!preview.data || sourceType === "html" || sourceType === null) {
      return null;
    }
    try {
      if (sourceType === "json") {
        return { value: JSON.parse(preview.data.html) };
      }
      const parser = new XMLParser(XML_PARSER_OPTIONS);
      return { value: parser.parse(preview.data.html) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, [preview.data, sourceType]);

  /**
   * Tests every non-empty candidate together in one call — the backend (`extractWithCss` /
   * `extractWithJsonPath` / `extractWithXml`, dispatched by `sourceType`) reports a score for each
   * and picks the first one that actually matches, so "Aperçu du résultat" stays correct even
   * while the user is mid-edit on some other, currently-broken row. `source` is always the raw
   * fetched text, never a re-serialized version of the client-side parsed tree — for XML in
   * particular this means the backend re-parses from scratch, exactly like a real `extract` node
   * would. `outputOverride`/`attributeOverride` let callers pass a not-yet-committed value (e.g.
   * from the very `onChange` that's about to call `setOutput`) without waiting for a re-render.
   */
  function runSelectorTest(
    selectors: string[],
    outputOverride?: ExtractOutputType,
    attributeOverride?: string,
  ): void {
    if (!preview.data || !sourceType) {
      return;
    }
    const nonEmpty = selectors.map((selector) => selector.trim()).filter((selector) => selector.length > 0);
    if (nonEmpty.length === 0) {
      return;
    }
    const effectiveOutput = outputOverride ?? output;
    const effectiveAttribute = attributeOverride ?? attribute;
    testSelector.mutate({
      source: preview.data.html,
      sourceType,
      selectors: nonEmpty,
      output: effectiveOutput,
      attribute: effectiveOutput === "attribute" ? effectiveAttribute : undefined,
    });
  }

  function scheduleSelectorTest(selectors: string[], attributeOverride?: string): void {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      runSelectorTest(selectors, undefined, attributeOverride);
    }, EDIT_DEBOUNCE_MS);
  }

  // HTML: the picker script running inside the sandboxed iframe reports a click via postMessage.
  useEffect(() => {
    if (sourceType !== "html") {
      return;
    }
    function handleMessage(event: MessageEvent): void {
      if (event.source !== iframeRef.current?.contentWindow) {
        return;
      }
      if (!isElementSelectedMessage(event.data)) {
        return;
      }
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      setSelectedLabel(event.data.tagName);
      setSelectedPathKey(null);
      setCandidates(event.data.selectors);
      setRuleName((current) => (current.length > 0 ? current : event.data.tagName));
      runSelectorTest(event.data.selectors);
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceType, preview.data, output, attribute]);

  // JSON/XML: a click inside JsonTreeView reports a path directly (no postMessage needed — it's
  // a plain React tree in this same document, not a sandboxed iframe).
  function handleTreeSelect(path: Array<string | number>, _value: unknown): void {
    const jsonPath = buildJsonPath(path);
    const lastSegment = path.at(-1);
    const label = lastSegment === undefined ? "racine" : String(lastSegment);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    setSelectedLabel(label);
    setSelectedPathKey(path.join(" "));
    setCandidates([jsonPath]);
    setRuleName((current) => (current.length > 0 ? current : label));
    runSelectorTest([jsonPath]);
  }

  function handleCandidateChange(index: number, value: string): void {
    const updated = candidates.map((candidate, i) => (i === index ? value : candidate));
    setCandidates(updated);
    scheduleSelectorTest(updated);
  }

  function handleAddCandidate(): void {
    setCandidates((current) => [...current, ""]);
  }

  function handleRemoveCandidate(index: number): void {
    const updated = candidates.filter((_, i) => i !== index);
    setCandidates(updated);
    runSelectorTest(updated);
  }

  function handleOutputChange(next: ExtractOutputType): void {
    setOutput(next);
    runSelectorTest(candidates, next);
  }

  function handleAttributeChange(value: string): void {
    setAttribute(value);
    if (output === "attribute") {
      scheduleSelectorTest(candidates, value);
    }
  }

  const scoreBySelector = useMemo(() => {
    const map = new Map<string, SelectorScoreDto>();
    for (const score of testSelector.data?.selectorScores ?? []) {
      map.set(score.selector, score);
    }
    return map;
  }, [testSelector.data]);

  const matchedSelector = testSelector.data?.matchedSelector;

  function handleAddRule(): void {
    if (!matchedSelector || ruleName.trim().length === 0 || !sourceType) {
      return;
    }
    // Every currently-working candidate becomes part of the rule's fallback chain (that's what
    // ExtractionRule.selectors is for), ordered best-scored first — not just the one selector
    // that happened to match first in submission order.
    const working = Array.from(
      new Set(candidates.map((candidate) => candidate.trim()).filter((candidate) => candidate.length > 0)),
    ).filter((candidate) => scoreBySelector.get(candidate)?.matched);
    const ordered = working.sort(
      (a, b) => (scoreBySelector.get(b)?.score ?? 0) - (scoreBySelector.get(a)?.score ?? 0),
    );
    const rule: ExtractionRule = {
      name: ruleName.trim(),
      strategy: sourceType === "html" ? "css" : "jsonpath",
      selectors: ordered.length > 0 ? ordered : [matchedSelector],
      output,
      attribute: output === "attribute" && attribute.trim().length > 0 ? attribute.trim() : undefined,
    };
    setAccumulatedRules((current) => [...current, rule]);
    setSelectedLabel(null);
    setSelectedPathKey(null);
    setCandidates([]);
    setRuleName("");
  }

  function handleFinish(): void {
    if (accumulatedRules.length === 0 || !sourceType) {
      return;
    }
    onValidate(accumulatedRules, sourceType);
  }

  const outputOptions: ExtractOutputType[] =
    sourceType === "html" ? ["text", "attribute", "list", "table", "value"] : ["value", "list"];

  const elementLabel = sourceType === "html" ? "Élément cliqué" : "Chemin cliqué";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2">
      <div className="flex h-full w-full overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex flex-1 flex-col border-r border-gray-200">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
            <h2 className="text-sm font-semibold text-gray-900">
              {canSelect
                ? "Aperçu — cliquez un élément à extraire"
                : "Aperçu"}
            </h2>
            {preview.data && (
              <span className="truncate text-xs text-gray-400">{preview.data.url}</span>
            )}
          </div>
          {sourceType === "html" && (
            <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-4 py-1.5">
              <label className="flex items-center gap-1.5 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={render}
                  onChange={(event) => setRender(event.target.checked)}
                />
                Rendu JavaScript (pages React/Vue…)
              </label>
              <span className="text-xs text-gray-400">
                — plus lent (navigateur headless côté serveur), pour les pages dont le contenu
                n&apos;existe qu&apos;après exécution du script.
              </span>
            </div>
          )}
          <div className="flex-1 overflow-auto bg-gray-50">
            {preview.isPending && (
              <p className="p-4 text-sm text-gray-500">
                {render
                  ? "Rendu de la page dans un navigateur headless… (jusqu'à 20 secondes)"
                  : "Chargement…"}
              </p>
            )}
            {preview.isError && (
              <p className="p-4 text-sm text-red-600">
                Impossible de charger la réponse :{" "}
                {preview.error instanceof Error ? preview.error.message : "erreur inconnue"}
              </p>
            )}
            {sourceType === "html" && sandboxedDocument && (
              <iframe
                ref={iframeRef}
                title="Aperçu de la page cible"
                srcDoc={sandboxedDocument}
                sandbox="allow-scripts"
                className="h-full w-full border-0 bg-white"
              />
            )}
            {(sourceType === "json" || sourceType === "xml") && parsedData && "error" in parsedData && (
              <div className="p-4">
                <p className="mb-2 text-sm text-red-600">
                  Impossible d&apos;analyser la réponse comme {sourceType.toUpperCase()} :{" "}
                  {parsedData.error}
                </p>
                <pre className="max-h-96 overflow-auto rounded-md bg-gray-900 p-3 text-xs text-gray-100">
                  {preview.data?.html}
                </pre>
              </div>
            )}
            {(sourceType === "json" || sourceType === "xml") && parsedData && "value" in parsedData && (
              <JsonTreeView
                value={parsedData.value}
                onSelect={handleTreeSelect}
                activePathKey={selectedPathKey}
              />
            )}
            {sourceType === null && preview.data && (
              <pre className="max-h-full overflow-auto whitespace-pre-wrap p-4 text-xs text-gray-800">
                {preview.data.html}
              </pre>
            )}
          </div>
        </div>

        <div className="flex w-96 flex-shrink-0 flex-col">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
            <h3 className="text-sm font-semibold text-gray-900">Sélection</h3>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
            >
              Fermer
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            {accumulatedRules.length > 0 && (
              <div className="mb-4 space-y-1">
                <p className="text-xs font-semibold uppercase text-gray-500">Règles ajoutées</p>
                {accumulatedRules.map((rule, index) => (
                  <div
                    key={`${rule.name}-${index}`}
                    className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700"
                  >
                    <span className="font-mono">{rule.selectors[0]}</span> → <strong>{rule.name}</strong>
                  </div>
                ))}
              </div>
            )}

            {!canSelect ? (
              <p className="text-sm text-gray-400">
                La sélection d&apos;élément n&apos;est pas disponible pour ce type de contenu —
                l&apos;aperçu ci-contre reste utile pour lire la réponse brute.
              </p>
            ) : selectedLabel === null ? (
              <p className="text-sm text-gray-400">
                Cliquez un élément dans l&apos;aperçu pour proposer des sélecteurs.
              </p>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-gray-500">
                  {elementLabel} : <span className="font-mono">{selectedLabel}</span>
                </p>

                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase text-gray-500">
                      {sourceType === "html" ? "Sélecteurs candidats" : "Chemins candidats (JSONPath)"}
                    </p>
                    <button
                      type="button"
                      onClick={handleAddCandidate}
                      className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                    >
                      + ajouter
                    </button>
                  </div>
                  <p className="mb-1 text-xs text-gray-400">
                    Éditables : corrigez ou complétez un sélecteur pour le re-tester automatiquement.
                  </p>
                  <div className="space-y-1">
                    {candidates.map((candidate, index) => {
                      const score = scoreBySelector.get(candidate);
                      const isMatched = candidate.trim().length > 0 && candidate === matchedSelector;
                      return (
                        <div
                          key={index}
                          className={`flex items-center gap-1.5 rounded-md border px-2 py-1 ${
                            isMatched ? "border-indigo-400 bg-indigo-50" : "border-gray-200 bg-white"
                          }`}
                        >
                          <input
                            value={candidate}
                            onChange={(event) => handleCandidateChange(index, event.target.value)}
                            placeholder={sourceType === "html" ? "sélecteur CSS" : "$.chemin.jsonpath"}
                            className="min-w-0 flex-1 bg-transparent font-mono text-xs focus:outline-none"
                          />
                          {score && (
                            <span
                              className={`flex-shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold ${
                                score.matched
                                  ? score.score >= 70
                                    ? "bg-green-100 text-green-700"
                                    : "bg-amber-100 text-amber-700"
                                  : "bg-red-100 text-red-700"
                              }`}
                            >
                              {score.matched ? score.score : "✕"}
                            </span>
                          )}
                          {candidates.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveCandidate(index)}
                              className="flex-shrink-0 text-xs text-gray-400 hover:text-red-600"
                              aria-label="Supprimer ce sélecteur"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-700">Type de sortie</label>
                    <select
                      value={output}
                      onChange={(event) => handleOutputChange(event.target.value as ExtractOutputType)}
                      className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
                    >
                      {outputOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                  {output === "attribute" && (
                    <div>
                      <label className="block text-xs font-medium text-gray-700">Attribut</label>
                      <input
                        value={attribute}
                        onChange={(event) => handleAttributeChange(event.target.value)}
                        placeholder="href, src, ..."
                        className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
                      />
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700">Nom de la règle</label>
                  <input
                    value={ruleName}
                    onChange={(event) => setRuleName(event.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
                  />
                </div>

                <div>
                  <p className="mb-1 text-xs font-semibold uppercase text-gray-500">Aperçu du résultat</p>
                  {matchedSelector ? (
                    <pre className="max-h-24 overflow-auto rounded-md bg-gray-900 p-2 text-xs text-gray-100">
                      {JSON.stringify(testSelector.data?.value, null, 2)}
                    </pre>
                  ) : (
                    <p className="rounded-md bg-gray-100 p-2 text-xs text-gray-500">
                      {testSelector.isPending
                        ? "Test en cours…"
                        : "Aucun sélecteur ne correspond encore — éditez-en un ci-dessus."}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleAddRule}
                  disabled={!matchedSelector || ruleName.trim().length === 0}
                  className="w-full rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                >
                  Ajouter cette règle
                </button>
              </div>
            )}
          </div>

          <div className="border-t border-gray-200 px-4 py-3">
            <button
              type="button"
              onClick={handleFinish}
              disabled={accumulatedRules.length === 0}
              className="w-full rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              Terminer ({accumulatedRules.length} règle{accumulatedRules.length === 1 ? "" : "s"})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
