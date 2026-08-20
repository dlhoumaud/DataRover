import { useRef, useState, type KeyboardEvent } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { extractTemplateQuery, insertTemplateVariable, type TemplateVariable } from "../lib/templateVariables";

/** Up to this many matches are shown at once — plenty to scan, without the dropdown ever
 *  growing taller than the input it hangs off of. */
const MAX_SUGGESTIONS = 8;

/**
 * Reacts SETS an uncontrolled `<input>`/`<textarea>`'s value through the same native property
 * setter the DOM itself uses (bypassing the one React patches to detect direct `.value =`
 * assignments and silently ignore them for elements it doesn't consider "controlled"), then fires
 * a real `input` event — the same trick browser extensions/automation tools use to make a
 * programmatic edit indistinguishable from the user having typed it. Necessary here because
 * `registration.onChange` (react-hook-form's own listener) only ever fires from a real DOM event,
 * never from React state — there is no other way to make a suggestion click actually update the
 * form.
 */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * A plain text `<input>`/`<textarea>` (still registered with react-hook-form exactly like any
 * other field — pass its `register(name)` return value as `registration`) that pops up an
 * autocomplete dropdown of `{{ }}`-usable variables as soon as the user types `{{`, filtered by
 * whatever they type next. See `lib/templateVariables.ts` for where `variables` comes from and
 * the exact trigger/insertion rules this builds on.
 */
export function TemplateInput({
  registration,
  variables,
  placeholder,
  className,
  wrapperClassName,
  multiline = false,
  rows,
}: {
  registration: UseFormRegisterReturn;
  variables: TemplateVariable[];
  placeholder?: string;
  className?: string;
  /** Applied to the outer wrapping `<div>` (always also `relative`, needed to position the
   *  dropdown) alongside `className` on the input/textarea itself — needed wherever the field
   *  used to be a direct flex child sized via e.g. `flex-1`, since that class now has to move to
   *  the wrapper for the row's layout to still work: `TemplateInput` renders one extra element
   *  around the field, so it — not the input inside it — is the direct flex child now. */
  wrapperClassName?: string;
  multiline?: boolean;
  rows?: number;
}): JSX.Element {
  const elementRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  // `null` = dropdown closed; "" = just typed `{{`, show everything unfiltered; anything else =
  // filter text typed so far after the `{{`.
  const [query, setQuery] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(0);

  const matches =
    query === null
      ? []
      : variables.filter((variable) => variable.path.toLowerCase().includes(query.toLowerCase())).slice(0, MAX_SUGGESTIONS);

  function syncQueryFromCursor(): void {
    const el = elementRef.current;
    if (!el) {
      return;
    }
    const cursor = el.selectionStart ?? el.value.length;
    setQuery(extractTemplateQuery(el.value, cursor));
    setHighlighted(0);
  }

  function selectVariable(path: string): void {
    const el = elementRef.current;
    if (!el) {
      return;
    }
    const cursor = el.selectionStart ?? el.value.length;
    const result = insertTemplateVariable(el.value, cursor, path);
    setNativeValue(el, result.value);
    el.setSelectionRange(result.cursor, result.cursor);
    el.focus();
    setQuery(null);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void {
    if (query === null || matches.length === 0) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((current) => (current + 1) % matches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((current) => (current - 1 + matches.length) % matches.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      const match = matches[highlighted];
      if (match) {
        event.preventDefault();
        selectVariable(match.path);
      }
    } else if (event.key === "Escape") {
      setQuery(null);
    }
  }

  const dropdown = query !== null && (
    <div className="absolute left-0 top-full z-20 mt-1 w-full overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg">
      {matches.length === 0 ? (
        <p className="px-2 py-1.5 text-xs text-gray-400">Aucune variable ne correspond.</p>
      ) : (
        <ul role="listbox" className="max-h-48 overflow-y-auto py-1">
          {matches.map((variable, index) => (
            <li key={variable.path}>
              <button
                type="button"
                role="option"
                aria-selected={index === highlighted}
                // `onMouseDown` + `preventDefault` (not `onClick`) so the input never blurs before
                // the click is handled — a blur would otherwise close this dropdown first.
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectVariable(variable.path);
                }}
                onMouseEnter={() => setHighlighted(index)}
                className={`block w-full truncate px-2 py-1 text-left font-mono text-xs ${
                  index === highlighted ? "bg-indigo-50 text-indigo-700" : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                {variable.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div className={`relative ${wrapperClassName ?? ""}`}>
      {multiline ? (
        <textarea
          {...registration}
          ref={(el) => {
            registration.ref(el);
            elementRef.current = el;
          }}
          placeholder={placeholder}
          rows={rows}
          className={className}
          onChange={(event) => {
            registration.onChange(event).catch(() => undefined);
            syncQueryFromCursor();
          }}
          onClick={syncQueryFromCursor}
          onKeyUp={syncQueryFromCursor}
          onKeyDown={handleKeyDown}
          onBlur={(event) => {
            registration.onBlur(event).catch(() => undefined);
            setQuery(null);
          }}
        />
      ) : (
        <input
          {...registration}
          ref={(el) => {
            registration.ref(el);
            elementRef.current = el;
          }}
          placeholder={placeholder}
          className={className}
          onChange={(event) => {
            registration.onChange(event).catch(() => undefined);
            syncQueryFromCursor();
          }}
          onClick={syncQueryFromCursor}
          onKeyUp={syncQueryFromCursor}
          onKeyDown={handleKeyDown}
          onBlur={(event) => {
            registration.onBlur(event).catch(() => undefined);
            setQuery(null);
          }}
        />
      )}
      {dropdown}
    </div>
  );
}
