import { useState, type FormEvent } from "react";
import type { ScheduleType } from "@datarover/workflow-types";
import { ApiError } from "../api/client";
import { useCreateSchedule, useDeleteSchedule, useSchedules, useSetScheduleEnabled } from "../api/schedules";
import type { ScheduleDto } from "../api/types";

const TYPE_LABELS: Record<ScheduleType, string> = {
  manual: "Manuel",
  interval: "Toutes les X minutes",
  hourly: "Toutes les heures",
  daily: "Tous les jours",
  weekly: "Toutes les semaines",
  cron: "Cron",
};

/** Human-readable one-liner for a schedule row — the same information the create form's fields
 * capture, read back in prose. */
function describeSchedule(schedule: ScheduleDto): string {
  switch (schedule.type) {
    case "manual":
      return "Manuel — jamais déclenché automatiquement";
    case "interval":
      return `Toutes les ${schedule.everyMinutes ?? "?"} minutes`;
    case "hourly":
      return "Toutes les heures (à l'heure pile)";
    case "daily":
      return "Tous les jours à minuit";
    case "weekly":
      return "Toutes les semaines (dimanche à minuit)";
    case "cron":
      return `Cron : ${schedule.cronExpression ?? "?"}`;
    default: {
      const exhaustiveCheck: never = schedule.type;
      return String(exhaustiveCheck);
    }
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/**
 * The scheduler's UI (Specs.md §14): lists every `Schedule` attached to the workflow currently
 * open in the editor, with a toggle for enabling/disabling each one and a small form to add a new
 * one. Each schedule's actual recurrence lives entirely server-side (a BullMQ job scheduler,
 * registered by the API — see ARCHITECTURE.md's "Scheduler exécutable" section); this panel is
 * just a thin view over the `/workflows/:workflowId/schedules` CRUD endpoints.
 *
 * Editing an existing schedule's type/parameters isn't supported (a deliberate scope cut mirrored
 * from the API's own `UpdateScheduleSchema`, which only accepts `enabled`) — changing the
 * recurrence means deleting and recreating it.
 */
export function SchedulesPanel({
  workflowId,
  onClose,
}: {
  workflowId: string;
  onClose: () => void;
}): JSX.Element {
  const schedulesQuery = useSchedules(workflowId);
  const createSchedule = useCreateSchedule(workflowId);
  const setEnabled = useSetScheduleEnabled(workflowId);
  const deleteSchedule = useDeleteSchedule(workflowId);

  const [type, setType] = useState<ScheduleType>("interval");
  const [everyMinutes, setEveryMinutes] = useState("5");
  const [cronExpression, setCronExpression] = useState("");

  function handleCreate(event: FormEvent): void {
    event.preventDefault();
    createSchedule.mutate(
      {
        type,
        everyMinutes: type === "interval" ? Number(everyMinutes) : undefined,
        cronExpression: type === "cron" ? cronExpression.trim() : undefined,
      },
      { onSuccess: () => setCronExpression("") },
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex w-full max-w-lg flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Planification</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
          >
            Fermer
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-4 py-4">
          {schedulesQuery.isPending && <p className="text-sm text-gray-500">Chargement…</p>}
          {schedulesQuery.isError && (
            <p className="text-sm text-red-600">
              {errorMessage(schedulesQuery.error, "Impossible de charger les planifications.")}
            </p>
          )}
          {schedulesQuery.data?.length === 0 && (
            <p className="text-sm text-gray-400">
              Aucune planification — ce workflow ne se déclenche que manuellement ("Exécuter").
            </p>
          )}

          {schedulesQuery.data && schedulesQuery.data.length > 0 && (
            <ul className="space-y-1.5">
              {schedulesQuery.data.map((schedule) => (
                <li
                  key={schedule.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-gray-200 px-3 py-2"
                >
                  <span className="text-sm text-gray-900">{describeSchedule(schedule)}</span>
                  <div className="flex flex-shrink-0 items-center gap-3">
                    <label className="flex items-center gap-1.5 text-xs text-gray-600">
                      <input
                        type="checkbox"
                        checked={schedule.enabled}
                        onChange={(event) =>
                          setEnabled.mutate({ id: schedule.id, enabled: event.target.checked })
                        }
                      />
                      Actif
                    </label>
                    <button
                      type="button"
                      onClick={() => deleteSchedule.mutate(schedule.id)}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      supprimer
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={handleCreate} className="mt-4 space-y-2 border-t border-gray-200 pt-4">
            <p className="text-xs font-semibold uppercase text-gray-500">Ajouter une planification</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-gray-700">Type</label>
                <select
                  value={type}
                  onChange={(event) => setType(event.target.value as ScheduleType)}
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                >
                  {Object.entries(TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              {type === "interval" && (
                <div>
                  <label className="block text-xs font-medium text-gray-700">Toutes les (minutes)</label>
                  <input
                    type="number"
                    min={1}
                    value={everyMinutes}
                    onChange={(event) => setEveryMinutes(event.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>
              )}
              {type === "cron" && (
                <div>
                  <label className="block text-xs font-medium text-gray-700">Expression cron</label>
                  <input
                    value={cronExpression}
                    onChange={(event) => setCronExpression(event.target.value)}
                    placeholder="*/5 * * * *"
                    className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 font-mono text-sm"
                  />
                </div>
              )}
            </div>
            {createSchedule.isError && (
              <p className="text-xs text-red-600">
                {errorMessage(createSchedule.error, "Impossible de créer cette planification.")}
              </p>
            )}
            <button
              type="submit"
              disabled={createSchedule.isPending || (type === "cron" && cronExpression.trim().length === 0)}
              className="w-full rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
            >
              Ajouter
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
