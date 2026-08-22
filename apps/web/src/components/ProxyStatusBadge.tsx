import type { ProxyStatus } from "../api/types";

interface StatusStyle {
  label: string;
  dotClassName: string;
  badgeClassName: string;
}

/** Same dot+label+color pattern as StatusBadge.tsx (executions) — kept as its own small component
 *  rather than folded into that one since the two status vocabularies are unrelated domains. */
const STATUS_STYLES: Record<ProxyStatus, StatusStyle> = {
  active: { label: "Actif", dotClassName: "bg-green-500", badgeClassName: "bg-green-100 text-green-700" },
  disabled: { label: "Désactivé", dotClassName: "bg-gray-400", badgeClassName: "bg-gray-100 text-gray-600" },
};

export function ProxyStatusBadge({ status }: { status: ProxyStatus }): JSX.Element {
  const style = STATUS_STYLES[status];
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${style.badgeClassName}`}>
      <span className={`h-2 w-2 rounded-full ${style.dotClassName}`} aria-hidden="true" />
      {style.label}
    </span>
  );
}
