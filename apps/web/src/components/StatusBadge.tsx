import type { ExecutionStatus } from "@datarover/workflow-types";

/**
 * Visual palette for an execution status, shared (in spirit — matching
 * Tailwind color families) by anything that needs to color-code execution
 * state elsewhere in the app, e.g. the log-level colors on
 * ExecutionDetailPage (error=red, warn=orange, info/cancelled/pending=gray).
 */
interface StatusStyle {
  label: string;
  dotClassName: string;
  badgeClassName: string;
}

const STATUS_STYLES: Record<ExecutionStatus, StatusStyle> = {
  pending: {
    label: "En attente",
    dotClassName: "bg-gray-400",
    badgeClassName: "bg-gray-100 text-gray-600",
  },
  running: {
    label: "En cours",
    dotClassName: "bg-blue-500 animate-pulse",
    badgeClassName: "bg-blue-100 text-blue-700",
  },
  success: {
    label: "Succès",
    dotClassName: "bg-green-500",
    badgeClassName: "bg-green-100 text-green-700",
  },
  failed: {
    label: "Échec",
    dotClassName: "bg-red-500",
    badgeClassName: "bg-red-100 text-red-700",
  },
  cancelled: {
    label: "Annulée",
    dotClassName: "bg-gray-400",
    badgeClassName: "bg-gray-100 text-gray-600",
  },
  retrying: {
    label: "Nouvelle tentative",
    dotClassName: "bg-orange-500",
    badgeClassName: "bg-orange-100 text-orange-700",
  },
};

/** Small colored pill reflecting an `ExecutionStatus` — dot + French label. */
export function StatusBadge({ status }: { status: ExecutionStatus }): JSX.Element {
  const style = STATUS_STYLES[status];

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${style.badgeClassName}`}
    >
      <span className={`h-2 w-2 rounded-full ${style.dotClassName}`} aria-hidden="true" />
      {style.label}
    </span>
  );
}
