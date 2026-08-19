import { useEffect, useMemo, useRef, useState } from "react";
import type { ExtractionRule, ExtractOutputType, HttpMethod } from "@datarover/workflow-types";
import { usePreviewHtml, useTestSelector } from "../api/tools";
import { buildSandboxedDocument, isElementSelectedMessage } from "../lib/htmlSandbox";
import type { SelectorScoreDto } from "../api/types";

/**
 * The "Prévisualiser & sélectionner" tool (Specs.md §6/§8): fetches the
 * target http node's page, renders it in a sandboxed iframe (see
 * htmlSandbox.ts for the security model — no script from the fetched page
 * ever runs), lets the user click an element to get scored selector
 * candidates, and accumulates validated rules into one or more extraction
 * rules the caller turns into an `extract` node.
 */
export function HtmlPreviewSelector({
  projectId,
  method,
  url,
  headers,
  queryParams,
  body,
  onClose,
  onValidate,
}: {
  projectId: string;
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  body?: unknown;
  onClose: () => void;
  onValidate: (rules: ExtractionRule[]) => void;
}): JSX.Element {
  const preview = usePreviewHtml();
  const testSelector = useTestSelector();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [accumulatedRules, setAccumulatedRules] = useState<ExtractionRule[]>([]);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [activeSelector, setActiveSelector] = useState<string | null>(null);
  const [ruleName, setRuleName] = useState("");
  const [output, setOutput] = useState<ExtractOutputType>("text");
  const [attribute, setAttribute] = useState("");

  useEffect(() => {
    preview.mutate({ projectId, method, url, headers, queryParams, body });
    // Intentionally re-runs only when the http node's own request shape
    // changes, not on every re-render (preview/testSelector are mutation
    // objects that change identity each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, method, url, headers, queryParams, body]);

  const sandboxedDocument = useMemo(() => {
    if (!preview.data) {
      return null;
    }
    return buildSandboxedDocument(preview.data.html, preview.data.url);
  }, [preview.data]);

  useEffect(() => {
    function handleMessage(event: MessageEvent): void {
      if (event.source !== iframeRef.current?.contentWindow) {
        return;
      }
      if (!isElementSelectedMessage(event.data)) {
        return;
      }
      setSelectedTag(event.data.tagName);
      setCandidates(event.data.selectors);
      setActiveSelector(event.data.selectors[0] ?? null);
      setRuleName((current) => (current.length > 0 ? current : event.data.tagName));
      if (!preview.data) {
        return;
      }
      testSelector.mutate({
        html: preview.data.html,
        selectors: event.data.selectors,
        output,
        attribute: output === "attribute" ? attribute : undefined,
      });
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview.data, output, attribute]);

  function handleSelectCandidate(selector: string): void {
    setActiveSelector(selector);
    if (!preview.data) {
      return;
    }
    testSelector.mutate({
      html: preview.data.html,
      selectors: [selector],
      output,
      attribute: output === "attribute" ? attribute : undefined,
    });
  }

  function handleOutputChange(next: ExtractOutputType): void {
    setOutput(next);
    if (!preview.data || !activeSelector) {
      return;
    }
    testSelector.mutate({
      html: preview.data.html,
      selectors: [activeSelector],
      output: next,
      attribute: next === "attribute" ? attribute : undefined,
    });
  }

  function handleAddRule(): void {
    if (!activeSelector || ruleName.trim().length === 0) {
      return;
    }
    const rule: ExtractionRule = {
      name: ruleName.trim(),
      strategy: "css",
      selectors: [activeSelector],
      output,
      attribute: output === "attribute" && attribute.trim().length > 0 ? attribute.trim() : undefined,
    };
    setAccumulatedRules((current) => [...current, rule]);
    setSelectedTag(null);
    setCandidates([]);
    setActiveSelector(null);
    setRuleName("");
  }

  function handleFinish(): void {
    if (accumulatedRules.length === 0) {
      return;
    }
    onValidate(accumulatedRules);
  }

  const scoreBySelector = useMemo(() => {
    const map = new Map<string, SelectorScoreDto>();
    for (const score of testSelector.data?.selectorScores ?? []) {
      map.set(score.selector, score);
    }
    return map;
  }, [testSelector.data]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2">
      <div className="flex h-full w-full overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex flex-1 flex-col border-r border-gray-200">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
            <h2 className="text-sm font-semibold text-gray-900">Aperçu — cliquez un élément à extraire</h2>
            {preview.data && (
              <span className="truncate text-xs text-gray-400">{preview.data.url}</span>
            )}
          </div>
          <div className="flex-1 overflow-auto bg-gray-50">
            {preview.isPending && (
              <p className="p-4 text-sm text-gray-500">Chargement de la page…</p>
            )}
            {preview.isError && (
              <p className="p-4 text-sm text-red-600">
                Impossible de charger la page :{" "}
                {preview.error instanceof Error ? preview.error.message : "erreur inconnue"}
              </p>
            )}
            {sandboxedDocument && (
              <iframe
                ref={iframeRef}
                title="Aperçu de la page cible"
                srcDoc={sandboxedDocument}
                sandbox="allow-scripts"
                className="h-full w-full border-0 bg-white"
              />
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

            {selectedTag === null ? (
              <p className="text-sm text-gray-400">
                Cliquez un élément dans l&apos;aperçu pour proposer des sélecteurs.
              </p>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-gray-500">
                  Élément cliqué : <span className="font-mono">{selectedTag}</span>
                </p>

                <div>
                  <p className="mb-1 text-xs font-semibold uppercase text-gray-500">
                    Sélecteurs candidats
                  </p>
                  <div className="space-y-1">
                    {candidates.map((candidate) => {
                      const score = scoreBySelector.get(candidate);
                      const isActive = candidate === activeSelector;
                      return (
                        <button
                          key={candidate}
                          type="button"
                          onClick={() => handleSelectCandidate(candidate)}
                          className={`flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-left text-xs ${
                            isActive
                              ? "border-indigo-400 bg-indigo-50"
                              : "border-gray-200 bg-white hover:bg-gray-50"
                          }`}
                        >
                          <span className="truncate font-mono">{candidate}</span>
                          {score && (
                            <span
                              className={`ml-2 flex-shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold ${
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
                        </button>
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
                      <option value="text">text</option>
                      <option value="attribute">attribute</option>
                      <option value="list">list</option>
                      <option value="table">table</option>
                      <option value="value">value</option>
                    </select>
                  </div>
                  {output === "attribute" && (
                    <div>
                      <label className="block text-xs font-medium text-gray-700">Attribut</label>
                      <input
                        value={attribute}
                        onChange={(event) => setAttribute(event.target.value)}
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

                {activeSelector && testSelector.data && (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase text-gray-500">
                      Aperçu du résultat
                    </p>
                    <pre className="max-h-24 overflow-auto rounded-md bg-gray-900 p-2 text-xs text-gray-100">
                      {JSON.stringify(testSelector.data.value, null, 2)}
                    </pre>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleAddRule}
                  disabled={!activeSelector || ruleName.trim().length === 0}
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
