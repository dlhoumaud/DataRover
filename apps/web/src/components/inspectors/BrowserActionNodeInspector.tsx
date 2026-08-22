import { useEffect, useRef, useState } from "react";
import { useForm, useFieldArray, useWatch, type Control, type UseFormRegister, type Path } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { NetworkModeSchema } from "@datarover/workflow-types";
import type { BrowserActionNode, BrowserActionStep, DelaySpec } from "@datarover/workflow-types";
import { TemplateInput } from "../TemplateInput";
import { BrowserSessionPreview } from "../BrowserSessionPreview";
import type { TemplateVariable } from "../../lib/templateVariables";

/** Same flattened-superset-form approach as TextCryptoNodeInspector — see its own doc comment.
 *  Every step variant's fields live side by side here; only the subset matching the row's own
 *  `type` is ever rendered or read back. Numeric fields are edited as free text (like
 *  HttpNodeInspector's `timeoutMs`) and parsed back to numbers on save. */
const STEP_TYPES = [
  "navigate",
  "click",
  "type",
  "press",
  "select",
  "hover",
  "moveMouse",
  "moveMouseRandom",
  "dragTo",
  "scrollIntoView",
  "scrollPage",
  "wait",
  "waitForSelector",
] as const;

/** Which of `DelaySpec`'s two shapes (or neither) a step's optional `delay` uses — its own field
 *  rather than reusing `type`/a boolean, so `type`/`moveMouse`/`moveMouseRandom` rows can share
 *  one `DelayFields` sub-form (see below) without colliding with the step-type selector above it. */
const DELAY_KINDS = ["none", "fixed", "random"] as const;

const StepFormSchema = z.object({
  type: z.enum(STEP_TYPES),
  url: z.string().optional(),
  selector: z.string().optional(),
  text: z.string().optional(),
  key: z.string().optional(),
  value: z.string().optional(),
  sourceSelector: z.string().optional(),
  targetSelector: z.string().optional(),
  x: z.string().optional(),
  y: z.string().optional(),
  ms: z.string().optional(),
  delayKind: z.enum(DELAY_KINDS).optional(),
  delayMs: z.string().optional(),
  delayMinMs: z.string().optional(),
  delayMaxMs: z.string().optional(),
});
type StepFormValues = z.infer<typeof StepFormSchema>;

/** Step types the live recorder (`recorderScript.ts`) can actually produce — the exact same 7
 *  values as that script's own `record({ type: ... })` call sites. Drives which steps show a
 *  "réenregistrer" button: re-recording only makes sense for a step type the recorder itself
 *  knows how to emit, never for `wait` (auto-computed timing, not a user gesture), `navigate`
 *  (never emitted — see the recorder's own doc comment), or the drag/scrollIntoView/waitForSelector
 *  steps that only ever get authored by hand. */
const RECORDABLE_STEP_TYPES: ReadonlySet<StepFormValues["type"]> = new Set([
  "click",
  "hover",
  "select",
  "type",
  "press",
  "moveMouse",
  "scrollPage",
]);

const BrowserActionFormSchema = z.object({
  name: z.string().min(1),
  startUrl: z.string(),
  timeoutMs: z.string(),
  networkMode: NetworkModeSchema,
  steps: z.array(StepFormSchema).min(1, "Au moins une étape"),
});
type BrowserActionFormValues = z.infer<typeof BrowserActionFormSchema>;

const STEP_TYPE_OPTIONS: ReadonlyArray<{ value: StepFormValues["type"]; label: string }> = [
  { value: "navigate", label: "Aller à l'URL" },
  { value: "click", label: "Cliquer" },
  { value: "type", label: "Taper du texte" },
  { value: "press", label: "Appuyer sur une touche" },
  { value: "select", label: "Sélectionner (liste déroulante)" },
  { value: "hover", label: "Survoler" },
  { value: "moveMouse", label: "Déplacer la souris (position X, Y)" },
  { value: "moveMouseRandom", label: "Déplacer la souris aléatoirement" },
  { value: "dragTo", label: "Glisser-déposer" },
  { value: "scrollIntoView", label: "Faire défiler jusqu'à un élément" },
  { value: "scrollPage", label: "Faire défiler la page" },
  { value: "wait", label: "Attendre" },
  { value: "waitForSelector", label: "Attendre qu'un élément apparaisse" },
];

/** `undefined` for an empty/non-numeric string — the caller decides whether that's fine (an
 *  optional field) or a reason to bail (a required one). */
function toNumber(text: string | undefined): number | undefined {
  if (text === undefined || text.trim().length === 0) {
    return undefined;
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

type DelayFormFields = Pick<StepFormValues, "delayKind" | "delayMs" | "delayMinMs" | "delayMaxMs">;

function delaySpecToForm(delay: DelaySpec | undefined): DelayFormFields {
  if (delay === undefined) {
    return { delayKind: "none", delayMs: "", delayMinMs: "", delayMaxMs: "" };
  }
  if (delay.kind === "fixed") {
    return { delayKind: "fixed", delayMs: String(delay.ms), delayMinMs: "", delayMaxMs: "" };
  }
  return { delayKind: "random", delayMs: "", delayMinMs: String(delay.minMs), delayMaxMs: String(delay.maxMs) };
}

/** `null` when `delayKind` is `"fixed"`/`"random"` but the number(s) it needs aren't filled in yet
 *  (or `maxMs < minMs`) — same "bail the whole step" convention as every other required field.
 *  `{ value: undefined }` (rather than just `undefined`) is what lets that "still typing, not
 *  ready yet" case be told apart from "deliberately no delay" (`delayKind` unset/`"none"`). */
function delayFormToSpec(row: DelayFormFields): { value: DelaySpec | undefined } | null {
  switch (row.delayKind) {
    case undefined:
    case "none":
      return { value: undefined };
    case "fixed": {
      const ms = toNumber(row.delayMs);
      return ms !== undefined ? { value: { kind: "fixed", ms } } : null;
    }
    case "random": {
      const minMs = toNumber(row.delayMinMs);
      const maxMs = toNumber(row.delayMaxMs);
      return minMs !== undefined && maxMs !== undefined && maxMs >= minMs
        ? { value: { kind: "random", minMs, maxMs } }
        : null;
    }
    default: {
      const exhaustiveCheck: never = row.delayKind;
      throw new Error(`Unsupported delay kind: ${String(exhaustiveCheck)}`);
    }
  }
}

function stepToFormValues(step: BrowserActionStep): StepFormValues {
  switch (step.type) {
    case "navigate":
      return { type: "navigate", url: step.url };
    case "click":
      return { type: "click", selector: step.selector };
    case "type":
      return { type: "type", selector: step.selector, text: step.text, ...delaySpecToForm(step.delay) };
    case "press":
      return { type: "press", key: step.key };
    case "select":
      return { type: "select", selector: step.selector, value: step.value };
    case "hover":
      return { type: "hover", selector: step.selector };
    case "moveMouse":
      return { type: "moveMouse", x: String(step.x), y: String(step.y), ...delaySpecToForm(step.delay) };
    case "moveMouseRandom":
      return { type: "moveMouseRandom", ...delaySpecToForm(step.delay) };
    case "dragTo":
      return { type: "dragTo", sourceSelector: step.sourceSelector, targetSelector: step.targetSelector };
    case "scrollIntoView":
      return { type: "scrollIntoView", selector: step.selector };
    case "scrollPage":
      return { type: "scrollPage", x: String(step.x), y: String(step.y) };
    case "wait":
      return { type: "wait", ms: String(step.ms) };
    case "waitForSelector":
      return { type: "waitForSelector", selector: step.selector };
    default: {
      const exhaustiveCheck: never = step;
      throw new Error(`Unsupported step: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

/** Returns `null` when a required field is missing — the caller bails the whole save in that case. */
function formValuesToStep(row: StepFormValues): BrowserActionStep | null {
  switch (row.type) {
    case "navigate":
      return row.url !== undefined && row.url.trim().length > 0 ? { type: "navigate", url: row.url } : null;
    case "click":
      return row.selector !== undefined && row.selector.trim().length > 0
        ? { type: "click", selector: row.selector }
        : null;
    case "type": {
      if (row.selector === undefined || row.selector.trim().length === 0) {
        return null;
      }
      const delay = delayFormToSpec(row);
      if (delay === null) {
        return null;
      }
      return {
        type: "type",
        selector: row.selector,
        text: row.text ?? "",
        ...(delay.value !== undefined ? { delay: delay.value } : {}),
      };
    }
    case "press":
      return row.key !== undefined && row.key.trim().length > 0 ? { type: "press", key: row.key } : null;
    case "select":
      return row.selector !== undefined && row.selector.trim().length > 0
        ? { type: "select", selector: row.selector, value: row.value ?? "" }
        : null;
    case "hover":
      return row.selector !== undefined && row.selector.trim().length > 0
        ? { type: "hover", selector: row.selector }
        : null;
    case "moveMouse": {
      const x = toNumber(row.x);
      const y = toNumber(row.y);
      if (x === undefined || y === undefined) {
        return null;
      }
      const delay = delayFormToSpec(row);
      if (delay === null) {
        return null;
      }
      return { type: "moveMouse", x, y, ...(delay.value !== undefined ? { delay: delay.value } : {}) };
    }
    case "moveMouseRandom": {
      const delay = delayFormToSpec(row);
      if (delay === null) {
        return null;
      }
      return { type: "moveMouseRandom", ...(delay.value !== undefined ? { delay: delay.value } : {}) };
    }
    case "dragTo":
      return row.sourceSelector !== undefined &&
        row.sourceSelector.trim().length > 0 &&
        row.targetSelector !== undefined &&
        row.targetSelector.trim().length > 0
        ? { type: "dragTo", sourceSelector: row.sourceSelector, targetSelector: row.targetSelector }
        : null;
    case "scrollIntoView":
      return row.selector !== undefined && row.selector.trim().length > 0
        ? { type: "scrollIntoView", selector: row.selector }
        : null;
    case "scrollPage": {
      const y = toNumber(row.y);
      return y !== undefined ? { type: "scrollPage", x: toNumber(row.x) ?? 0, y } : null;
    }
    case "wait": {
      const ms = toNumber(row.ms);
      return ms !== undefined && ms > 0 ? { type: "wait", ms } : null;
    }
    case "waitForSelector":
      return row.selector !== undefined && row.selector.trim().length > 0
        ? { type: "waitForSelector", selector: row.selector }
        : null;
    default: {
      const exhaustiveCheck: never = row.type;
      throw new Error(`Unsupported step type: ${String(exhaustiveCheck)}`);
    }
  }
}

/**
 * The optional-delay sub-form shared by `type` (inter-keystroke pacing), `moveMouse` and
 * `moveMouseRandom` (a pause after the move settles) — see `DelaySpecSchema`'s doc comment for
 * why "random" exists at all: a fixed number replays identically every time, which doesn't read
 * as human. Kept as its own component (not inlined 3 times in `StepRow`) so the three call sites
 * can't silently drift apart from each other.
 */
function DelayFields({
  control,
  register,
  index,
}: {
  control: Control<BrowserActionFormValues>;
  register: UseFormRegister<BrowserActionFormValues>;
  index: number;
}): JSX.Element {
  const delayKind = useWatch({ control, name: `steps.${index}.delayKind` as Path<BrowserActionFormValues> });

  return (
    <div className="space-y-1.5 rounded-md bg-gray-50 p-2">
      <label className="block text-xs font-medium text-gray-500">
        Délai (optionnel — simule un temps de réaction humain)
      </label>
      <select
        {...register(`steps.${index}.delayKind` as Path<BrowserActionFormValues>)}
        className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
      >
        <option value="none">Aucun</option>
        <option value="fixed">Fixe</option>
        <option value="random">Aléatoire (entre min et max, tiré à nouveau à chaque fois)</option>
      </select>
      {delayKind === "fixed" && (
        <input
          type="number"
          {...register(`steps.${index}.delayMs` as Path<BrowserActionFormValues>)}
          placeholder="Délai (ms)"
          className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
        />
      )}
      {delayKind === "random" && (
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number"
            {...register(`steps.${index}.delayMinMs` as Path<BrowserActionFormValues>)}
            placeholder="Min (ms)"
            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
          <input
            type="number"
            {...register(`steps.${index}.delayMaxMs` as Path<BrowserActionFormValues>)}
            placeholder="Max (ms)"
            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
        </div>
      )}
    </div>
  );
}

function StepRow({
  control,
  register,
  index,
  onRemove,
  canRemove,
  onMoveUp,
  onMoveDown,
  onReRecord,
  variables,
}: {
  control: Control<BrowserActionFormValues>;
  register: UseFormRegister<BrowserActionFormValues>;
  index: number;
  onRemove: () => void;
  canRemove: boolean;
  /** `undefined` at the top/bottom of the list, or whenever the caller has nothing to move it
   *  into (see `BrowserActionNodeInspector`'s own use of these) — renders the arrow disabled
   *  rather than omitting it, so the row of buttons doesn't visually jump around per step. */
  onMoveUp: (() => void) | undefined;
  onMoveDown: (() => void) | undefined;
  /** `undefined` when this step's own type isn't one the recorder can produce
   *  (`RECORDABLE_STEP_TYPES`) or no `startUrl` is configured yet — hides the button entirely
   *  rather than rendering it disabled, since there's nothing a click on it could ever open. */
  onReRecord: (() => void) | undefined;
  variables: TemplateVariable[];
}): JSX.Element {
  const type = useWatch({ control, name: `steps.${index}.type` as Path<BrowserActionFormValues> });

  const selectorField = (placeholder = "#selecteur, .classe, …"): JSX.Element => (
    <TemplateInput
      registration={register(`steps.${index}.selector` as Path<BrowserActionFormValues>)}
      variables={variables}
      placeholder={placeholder}
      wrapperClassName="mt-2"
      className="w-full rounded-md border border-gray-300 px-2 py-1 font-mono text-sm"
    />
  );

  return (
    <div className="rounded-md border border-gray-200 p-3">
      <div className="flex items-center gap-2">
        <select
          {...register(`steps.${index}.type` as Path<BrowserActionFormValues>)}
          className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm"
        >
          {STEP_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onMoveUp}
          disabled={!onMoveUp}
          aria-label="Monter l'étape"
          title="Monter"
          className="flex-shrink-0 rounded px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
        >
          ▲
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={!onMoveDown}
          aria-label="Descendre l'étape"
          title="Descendre"
          className="flex-shrink-0 rounded px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
        >
          ▼
        </button>
        {onReRecord && (
          <button
            type="button"
            onClick={onReRecord}
            title="Ré-enregistrer cette étape depuis l'aperçu en direct, sans changer sa position"
            className="flex-shrink-0 text-xs text-indigo-600 hover:text-indigo-800"
          >
            🔄 réenregistrer
          </button>
        )}
        {canRemove && (
          <button type="button" onClick={onRemove} className="flex-shrink-0 text-xs text-red-500 hover:text-red-700">
            supprimer
          </button>
        )}
      </div>

      {type === "navigate" && (
        <TemplateInput
          registration={register(`steps.${index}.url` as Path<BrowserActionFormValues>)}
          variables={variables}
          placeholder="{{ global.baseUrl }}/page-suivante"
          wrapperClassName="mt-2"
          className="w-full rounded-md border border-gray-300 px-2 py-1 font-mono text-sm"
        />
      )}

      {(type === "click" || type === "hover" || type === "scrollIntoView" || type === "waitForSelector") &&
        selectorField()}

      {type === "moveMouse" && (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              {...register(`steps.${index}.x` as Path<BrowserActionFormValues>)}
              placeholder="x"
              className="rounded-md border border-gray-300 px-2 py-1 text-sm"
            />
            <input
              type="number"
              {...register(`steps.${index}.y` as Path<BrowserActionFormValues>)}
              placeholder="y"
              className="rounded-md border border-gray-300 px-2 py-1 text-sm"
            />
          </div>
          <DelayFields control={control} register={register} index={index} />
        </div>
      )}

      {type === "moveMouseRandom" && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-gray-400">
            Déplace la souris vers une position aléatoire de la fenêtre visible — utile entre deux
            actions pour simuler une pause/hésitation humaine, sans viser un élément précis.
          </p>
          <DelayFields control={control} register={register} index={index} />
        </div>
      )}

      {type === "type" && (
        <div className="mt-2 space-y-2">
          {selectorField("#champ-de-saisie")}
          <TemplateInput
            registration={register(`steps.${index}.text` as Path<BrowserActionFormValues>)}
            variables={variables}
            placeholder="Texte à taper (caractère par caractère)"
            className="w-full rounded-md border border-gray-300 px-2 py-1 font-mono text-sm"
          />
          <DelayFields control={control} register={register} index={index} />
        </div>
      )}

      {type === "press" && (
        <TemplateInput
          registration={register(`steps.${index}.key` as Path<BrowserActionFormValues>)}
          variables={variables}
          placeholder="Enter, Tab, Escape, …"
          wrapperClassName="mt-2"
          className="w-full rounded-md border border-gray-300 px-2 py-1 font-mono text-sm"
        />
      )}

      {type === "select" && (
        <div className="mt-2 space-y-2">
          {selectorField()}
          <TemplateInput
            registration={register(`steps.${index}.value` as Path<BrowserActionFormValues>)}
            variables={variables}
            placeholder="Valeur à sélectionner"
            className="w-full rounded-md border border-gray-300 px-2 py-1 font-mono text-sm"
          />
        </div>
      )}

      {type === "dragTo" && (
        <div className="mt-2 space-y-2">
          <TemplateInput
            registration={register(`steps.${index}.sourceSelector` as Path<BrowserActionFormValues>)}
            variables={variables}
            placeholder="Sélecteur source"
            className="w-full rounded-md border border-gray-300 px-2 py-1 font-mono text-sm"
          />
          <TemplateInput
            registration={register(`steps.${index}.targetSelector` as Path<BrowserActionFormValues>)}
            variables={variables}
            placeholder="Sélecteur cible"
            className="w-full rounded-md border border-gray-300 px-2 py-1 font-mono text-sm"
          />
        </div>
      )}

      {type === "scrollPage" && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <input
            type="number"
            {...register(`steps.${index}.x` as Path<BrowserActionFormValues>)}
            placeholder="x (0 par défaut)"
            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
          <input
            type="number"
            {...register(`steps.${index}.y` as Path<BrowserActionFormValues>)}
            placeholder="y"
            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
        </div>
      )}

      {type === "wait" && (
        <input
          type="number"
          {...register(`steps.${index}.ms` as Path<BrowserActionFormValues>)}
          placeholder="Durée (ms)"
          className="mt-2 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
        />
      )}
    </div>
  );
}

export function BrowserActionNodeInspector({
  node,
  onChange,
  variables = [],
}: {
  node: BrowserActionNode;
  onChange: (updated: BrowserActionNode) => void;
  /** `{{ }}` autocomplete entries for `startUrl` and every templated step field — see
   *  TemplateInput. Optional (default `[]`) purely for symmetry with this app's other
   *  inspectors — unlike them, this one is never reused inside a loop's embedded body (see
   *  `LoopBodyNodeSchema`'s doc comment), so there is no actual caller that omits it today. */
  variables?: TemplateVariable[];
}): JSX.Element {
  const nodeRef = useRef(node);
  nodeRef.current = node;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Seeded with the incoming node itself (not `null`, unlike TextCryptoNodeInspector's otherwise
  // equivalent ref) — see the effect below for why: this node type's steps can legitimately start
  // out schema-invalid (an old workflow saved before a step was finished, say), which makes the
  // "first successful parse only seeds the ref, doesn't fire onChange" trick unsafe here — that
  // first success might be a real edit, not just the mount-time echo it's meant to filter out.
  const lastSentRef = useRef<string>(JSON.stringify(node));
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  // Index of the step being re-recorded in place, or `null` when the preview was opened from the
  // node's general "Aperçu en direct" button (append mode) — see `handleValidateRecording`.
  const [replacingIndex, setReplacingIndex] = useState<number | null>(null);

  const {
    register,
    control,
    formState: { errors },
  } = useForm<BrowserActionFormValues>({
    resolver: zodResolver(BrowserActionFormSchema),
    mode: "onChange",
    defaultValues: {
      name: node.name,
      startUrl: node.startUrl,
      timeoutMs: node.timeoutMs !== undefined ? String(node.timeoutMs) : "",
      networkMode: node.networkMode,
      steps: node.steps.map(stepToFormValues),
    },
  });

  const stepsArray = useFieldArray({ control, name: "steps" });
  const watchedValues = useWatch({ control });

  useEffect(() => {
    const parsed = BrowserActionFormSchema.safeParse(watchedValues);
    if (!parsed.success) {
      return;
    }

    const steps = parsed.data.steps.map(formValuesToStep);
    if (steps.some((step) => step === null)) {
      return;
    }

    let timeoutMs: number | undefined;
    if (parsed.data.timeoutMs.trim().length > 0) {
      const parsedTimeout = Number(parsed.data.timeoutMs);
      if (!Number.isInteger(parsedTimeout) || parsedTimeout <= 0) {
        return;
      }
      timeoutMs = parsedTimeout;
    }

    const updated: BrowserActionNode = {
      ...nodeRef.current,
      name: parsed.data.name,
      startUrl: parsed.data.startUrl,
      steps: steps as BrowserActionStep[],
      timeoutMs,
      networkMode: parsed.data.networkMode,
    };

    const serialized = JSON.stringify(updated);
    if (serialized === lastSentRef.current) {
      return;
    }
    lastSentRef.current = serialized;
    onChangeRef.current(updated);
  }, [watchedValues]);

  const currentStartUrl = watchedValues.startUrl ?? node.startUrl;

  /** From `BrowserSessionPreview`'s "Valider"/"Remplacer" — normally appends every recorded step
   *  to the end of the list, exactly like clicking "+ ajouter une action" that many times in a
   *  row, since a recorded step is already a complete, valid `BrowserActionStep` (unlike a
   *  freshly appended blank row, it never needs `stepToFormValues`' null-safety dance to fill
   *  in). When opened from a single step's own "réenregistrer" button instead (`replacingIndex`
   *  set), the newly recorded step(s) are spliced in at that exact position instead — the
   *  preview always appends internally, so without this the corrected step would land at the
   *  end of the list and the user would have to drag it back into place by hand (no reordering
   *  existed here until the '.full-width' strict-mode bug made "fix just this one step" a real,
   *  recurring need). */
  function handleValidateRecording(steps: BrowserActionStep[]): void {
    if (replacingIndex !== null) {
      stepsArray.remove(replacingIndex);
      stepsArray.insert(replacingIndex, steps.map(stepToFormValues));
      setReplacingIndex(null);
      return;
    }
    for (const step of steps) {
      stepsArray.append(stepToFormValues(step));
    }
  }

  function handleClosePreview(): void {
    setIsPreviewOpen(false);
    setReplacingIndex(null);
  }

  function handleOpenPreviewToAppend(): void {
    setReplacingIndex(null);
    setIsPreviewOpen(true);
  }

  function handleReRecordStep(index: number): void {
    setReplacingIndex(index);
    setIsPreviewOpen(true);
  }

  const replacingStep = replacingIndex !== null ? watchedValues.steps?.[replacingIndex] : undefined;
  const replaceLabel = replacingStep
    ? [
        STEP_TYPE_OPTIONS.find((option) => option.value === replacingStep.type)?.label ?? replacingStep.type,
        replacingStep.selector || replacingStep.key,
      ]
        .filter(Boolean)
        .join(" — ")
    : undefined;

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

      <div>
        <label className="block text-sm font-medium text-gray-700">URL de départ</label>
        <TemplateInput
          registration={register("startUrl")}
          variables={variables}
          placeholder="{{ global.baseUrl }}/login"
          wrapperClassName="mt-1"
          className="w-full rounded-md border border-gray-300 px-2 py-1.5 font-mono text-sm"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">Mode réseau</label>
        <select
          {...register("networkMode")}
          aria-label="Mode réseau"
          className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="direct">Adresse actuelle</option>
          <option value="proxy">Proxy disponible</option>
        </select>
        <p className="mt-1 text-xs text-gray-400">
          "Proxy disponible" réserve automatiquement un proxy du pool global pour cette session.
        </p>
      </div>

      {currentStartUrl.trim().length > 0 && (
        <div>
          <button
            type="button"
            onClick={handleOpenPreviewToAppend}
            className="w-full rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100"
          >
            Aperçu en direct &amp; enregistrement d&apos;actions
          </button>
        </div>
      )}

      {isPreviewOpen && (
        <BrowserSessionPreview
          startUrl={currentStartUrl}
          onClose={handleClosePreview}
          onValidate={handleValidateRecording}
          replaceLabel={replaceLabel}
        />
      )}

      <div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">Actions (rejouées dans l&apos;ordre)</span>
          <button
            type="button"
            // `wait`, not `click` — see workflowGraph.ts's createDefaultNode doc comment: every
            // other step type starts with an empty required field, which would block the whole
            // node's save (name/startUrl included) until that field is filled in.
            onClick={() => stepsArray.append({ type: "wait", ms: "500" })}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
          >
            + ajouter une action
          </button>
        </div>
        {errors.steps?.root?.message && (
          <p className="mt-1 text-xs text-red-600">{errors.steps.root.message}</p>
        )}
        <div className="mt-2 space-y-2">
          {stepsArray.fields.map((field, index) => (
            <StepRow
              key={field.id}
              control={control}
              register={register}
              index={index}
              canRemove={stepsArray.fields.length > 1}
              onRemove={() => stepsArray.remove(index)}
              onMoveUp={index > 0 ? () => stepsArray.move(index, index - 1) : undefined}
              onMoveDown={
                index < stepsArray.fields.length - 1 ? () => stepsArray.move(index, index + 1) : undefined
              }
              onReRecord={
                currentStartUrl.trim().length > 0 &&
                RECORDABLE_STEP_TYPES.has((watchedValues.steps?.[index]?.type ?? "wait") as StepFormValues["type"])
                  ? () => handleReRecordStep(index)
                  : undefined
              }
              variables={variables}
            />
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">Timeout (ms)</label>
        <input
          type="number"
          {...register("timeoutMs")}
          className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        />
        <p className="mt-1 text-xs text-gray-400">
          Budget global pour toute la séquence d&apos;actions (30 000 ms par défaut) — les
          nouvelles tentatives automatiques (retryPolicy) ne sont pas disponibles pour ce type de
          node : rejouer la séquence entière après un clic déjà réussi (ex. une soumission de
          formulaire) serait risqué.
        </p>
      </div>
    </div>
  );
}
