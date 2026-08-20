import { useEffect, useRef, useState } from "react";
import { useForm, useFieldArray, useWatch, type Path } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  HttpNodeSchema,
  type ExtractionRule,
  type ExtractSourceType,
  type HttpNode,
} from "@datarover/workflow-types";
import { PreviewSelector } from "../PreviewSelector";
import { TemplateInput } from "../TemplateInput";
import type { TemplateVariable } from "../../lib/templateVariables";

/**
 * Form schema derived from `HttpNodeSchema`: the scalar fields (name,
 * method, url, responseType) are reused as-is; `headers`/`queryParams`
 * (domain: `Record<string, string>`) are reshaped into key/value pair
 * arrays for `useFieldArray`; `body` (domain: `unknown`) is edited as a raw
 * JSON string (`bodyRaw`) and parsed back on save; `timeoutMs` (domain:
 * `number`) is edited as free text and parsed back on save. `retryPolicy`
 * has no field in this form and is preserved from the original node as-is.
 */
const HttpFormSchema = HttpNodeSchema.omit({
  id: true,
  type: true,
  headers: true,
  queryParams: true,
  body: true,
  timeoutMs: true,
  retryPolicy: true,
}).extend({
  timeoutMs: z.string(),
  headers: z.array(z.object({ key: z.string().min(1, "Clé requise"), value: z.string() })),
  queryParams: z.array(z.object({ key: z.string().min(1, "Clé requise"), value: z.string() })),
  bodyRaw: z.string(),
});

type HttpFormValues = z.infer<typeof HttpFormSchema>;

const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

function recordToPairs(record: Record<string, string> | undefined): Array<{ key: string; value: string }> {
  return Object.entries(record ?? {}).map(([key, value]) => ({ key, value }));
}

function pairsToRecord(pairs: Array<{ key: string; value: string }>): Record<string, string> | undefined {
  const entries = pairs.filter((pair) => pair.key.trim().length > 0);
  if (entries.length === 0) {
    return undefined;
  }
  const record: Record<string, string> = {};
  for (const pair of entries) {
    record[pair.key] = pair.value;
  }
  return record;
}

export function HttpNodeInspector({
  node,
  onChange,
  projectId,
  onCreateExtractNode,
  variables = [],
}: {
  node: HttpNode;
  onChange: (updated: HttpNode) => void;
  /** `{{ }}` autocomplete entries for url/headers/queryParams/body — see TemplateInput. Optional
   *  (default `[]`) so LoopNodeInspector's embedded-body usage doesn't need updating at the same
   *  time. */
  variables?: TemplateVariable[];
  /**
   * Needed to interpolate the preview URL against the project's global variables (Specs.md §6).
   * Optional along with `onCreateExtractNode`: when this inspector is reused for a step inside a
   * `loop` node's embedded body (LoopNodeInspector), the preview tool isn't wired up (creating an
   * `extract` node from inside a loop body is out of scope for this iteration — see
   * LoopNodeInspector's doc comment) and the button is hidden entirely rather than shown disabled.
   */
  projectId?: string;
  /**
   * Invoked with the accumulated rules and the sourceType they were built against once the user
   * validates the preview & selection tool ("Terminer") — the caller (WorkflowEditorPage) turns
   * this into a new `extract` node wired to this http node.
   */
  onCreateExtractNode?: (rules: ExtractionRule[], sourceType: ExtractSourceType) => void;
}): JSX.Element {
  const nodeRef = useRef(node);
  nodeRef.current = node;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const lastSentRef = useRef<string | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const {
    register,
    control,
    formState: { errors },
  } = useForm<HttpFormValues>({
    resolver: zodResolver(HttpFormSchema),
    mode: "onChange",
    defaultValues: {
      name: node.name,
      method: node.method,
      url: node.url,
      responseType: node.responseType,
      timeoutMs: node.timeoutMs !== undefined ? String(node.timeoutMs) : "",
      headers: recordToPairs(node.headers),
      queryParams: recordToPairs(node.queryParams),
      bodyRaw: node.body !== undefined ? JSON.stringify(node.body, null, 2) : "",
    },
  });

  const headersArray = useFieldArray({ control, name: "headers" });
  const queryParamsArray = useFieldArray({ control, name: "queryParams" });
  const method = useWatch({ control, name: "method" });
  const watchedValues = useWatch({ control });

  useEffect(() => {
    const parsed = HttpFormSchema.safeParse(watchedValues);
    if (!parsed.success) {
      return;
    }
    const values = parsed.data;

    let body: unknown;
    if (values.bodyRaw.trim().length === 0) {
      body = undefined;
      setBodyError(null);
    } else {
      try {
        body = JSON.parse(values.bodyRaw) as unknown;
        setBodyError(null);
      } catch {
        setBodyError("JSON invalide");
        return;
      }
    }

    let timeoutMs: number | undefined;
    if (values.timeoutMs.trim().length > 0) {
      const parsedTimeout = Number(values.timeoutMs);
      if (!Number.isInteger(parsedTimeout) || parsedTimeout <= 0) {
        return;
      }
      timeoutMs = parsedTimeout;
    }

    const updated: HttpNode = {
      ...nodeRef.current,
      name: values.name,
      method: values.method,
      url: values.url,
      responseType: values.responseType,
      headers: pairsToRecord(values.headers),
      queryParams: pairsToRecord(values.queryParams),
      body,
      timeoutMs,
    };

    const serialized = JSON.stringify(updated);
    const isFirstRun = lastSentRef.current === null;
    if (serialized === lastSentRef.current) {
      return;
    }
    lastSentRef.current = serialized;
    if (isFirstRun) {
      return;
    }
    onChangeRef.current(updated);
  }, [watchedValues]);

  const showBody = BODY_METHODS.has(method);

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700">Nom</label>
        <input
          {...register("name")}
          className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        />
        {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700">Méthode</label>
          <select
            {...register("method")}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="PATCH">PATCH</option>
            <option value="DELETE">DELETE</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Type de réponse</label>
          <select
            {...register("responseType")}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="html">html</option>
            <option value="json">json</option>
            <option value="xml">xml</option>
            <option value="text">text</option>
            <option value="file">file</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">URL</label>
        <TemplateInput
          registration={register("url")}
          variables={variables}
          placeholder="{{ global.baseUrl }}/products"
          wrapperClassName="mt-1"
          className="w-full rounded-md border border-gray-300 px-2 py-1.5 font-mono text-sm"
        />
        {errors.url && <p className="mt-1 text-xs text-red-600">{errors.url.message}</p>}
      </div>

      {projectId !== undefined &&
        onCreateExtractNode !== undefined &&
        node.responseType !== "file" &&
        node.url.trim().length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setIsPreviewOpen(true)}
              className="w-full rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100"
            >
              {node.responseType === "html" ? "Prévisualiser & sélectionner un élément" : "Prévisualiser"}
            </button>
          </div>
        )}

      {isPreviewOpen && projectId !== undefined && onCreateExtractNode !== undefined && (
        <PreviewSelector
          projectId={projectId}
          method={node.method}
          url={node.url}
          headers={node.headers}
          queryParams={node.queryParams}
          body={node.body}
          responseType={node.responseType}
          onClose={() => setIsPreviewOpen(false)}
          onValidate={(rules, sourceType) => {
            onCreateExtractNode(rules, sourceType);
            setIsPreviewOpen(false);
          }}
        />
      )}

      <div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">En-têtes</span>
          <button
            type="button"
            onClick={() => headersArray.append({ key: "", value: "" })}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
          >
            + ajouter
          </button>
        </div>
        <div className="mt-1 space-y-1.5">
          {headersArray.fields.map((field, index) => (
            <div key={field.id} className="flex items-center gap-1.5">
              <input
                {...register(`headers.${index}.key` as Path<HttpFormValues>)}
                placeholder="Clé"
                className="w-1/3 rounded-md border border-gray-300 px-2 py-1 text-sm"
              />
              <TemplateInput
                registration={register(`headers.${index}.value` as Path<HttpFormValues>)}
                variables={variables}
                placeholder="Valeur"
                wrapperClassName="flex-1"
                className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
              />
              <button
                type="button"
                onClick={() => headersArray.remove(index)}
                className="text-xs text-red-500 hover:text-red-700"
              >
                supprimer
              </button>
            </div>
          ))}
          {headersArray.fields.length === 0 && <p className="text-xs text-gray-400">Aucun en-tête.</p>}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">Paramètres de requête</span>
          <button
            type="button"
            onClick={() => queryParamsArray.append({ key: "", value: "" })}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
          >
            + ajouter
          </button>
        </div>
        <div className="mt-1 space-y-1.5">
          {queryParamsArray.fields.map((field, index) => (
            <div key={field.id} className="flex items-center gap-1.5">
              <input
                {...register(`queryParams.${index}.key` as Path<HttpFormValues>)}
                placeholder="Clé"
                className="w-1/3 rounded-md border border-gray-300 px-2 py-1 text-sm"
              />
              <TemplateInput
                registration={register(`queryParams.${index}.value` as Path<HttpFormValues>)}
                variables={variables}
                placeholder="Valeur"
                wrapperClassName="flex-1"
                className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
              />
              <button
                type="button"
                onClick={() => queryParamsArray.remove(index)}
                className="text-xs text-red-500 hover:text-red-700"
              >
                supprimer
              </button>
            </div>
          ))}
          {queryParamsArray.fields.length === 0 && (
            <p className="text-xs text-gray-400">Aucun paramètre.</p>
          )}
        </div>
      </div>

      {showBody && (
        <div>
          <label className="block text-sm font-medium text-gray-700">Corps (JSON)</label>
          <TemplateInput
            registration={register("bodyRaw")}
            variables={variables}
            multiline
            rows={6}
            wrapperClassName="mt-1"
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 font-mono text-sm"
          />
          {bodyError && <p className="mt-1 text-xs text-red-600">{bodyError}</p>}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700">Timeout (ms)</label>
        <input
          type="number"
          {...register("timeoutMs")}
          className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        />
      </div>
    </div>
  );
}
