import {
  FIELD_LABELS,
  formatTrackedValue,
  LIST_FIELD_LABELS,
  STATUS_LABELS,
} from "@/lib/brief/labels";
import type { TrackedFieldName, TripBrief } from "@/lib/brief/schema";

export const MANDATORY: readonly TrackedFieldName[] = [
  "destination",
  "dates",
  "duration",
  "travelers",
  "budget",
];

const USEFUL = [
  "projectMaturity",
  "occasion",
  "departureCountry",
  "rhythm",
  "accommodation",
  "guidance",
] as const;

const STATUS_CLASS: Record<keyof typeof STATUS_LABELS, string> = {
  confirmed: "border-secondary/40 bg-accent text-accent-foreground",
  inferred: "border-warning bg-warning-surface text-warning-foreground",
  missing: "border-input text-muted-foreground",
};

function StatusBadge({ status }: { status: keyof typeof STATUS_LABELS }) {
  return (
    <span
      className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${STATUS_CLASS[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export function BriefFields({ brief }: { brief: TripBrief | undefined }) {
  return (
    <dl className="flex flex-col gap-3">
      {[...MANDATORY, ...USEFUL].map((field) => {
        const entry = brief?.[field];
        if (!entry && !MANDATORY.includes(field)) return null;
        return (
          <div key={field}>
            <dt className="text-xs font-medium tracking-wide text-muted-foreground">
              {FIELD_LABELS[field]}
            </dt>
            <dd className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span>{entry ? formatTrackedValue(field, entry.value) : STATUS_LABELS.missing}</span>
              {entry && <StatusBadge status={entry.status} />}
            </dd>
          </div>
        );
      })}
      {(["interests", "constraints"] as const).map((field) =>
        brief && brief[field].length > 0 ? (
          <div key={field}>
            <dt className="text-xs font-medium tracking-wide text-muted-foreground">
              {LIST_FIELD_LABELS[field]}
            </dt>
            <dd className="mt-0.5">{brief[field].join(" · ")}</dd>
          </div>
        ) : null,
      )}
    </dl>
  );
}
