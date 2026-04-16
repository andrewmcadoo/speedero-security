import type { TravelLeg } from "@/types/schedule";

const labelClass = "text-[10px] text-gray-500 mb-0.5";
const valueClass = "text-xs text-gray-100";

function display(value: string): string {
  return value === "" ? "—" : value;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className={`${labelClass} min-w-[160px] shrink-0 uppercase`}>
        {label}
      </div>
      <div className={valueClass}>{value}</div>
    </div>
  );
}

export function TravelDetailsSection({ leg }: { leg: TravelLeg }) {
  return (
    <details className="group rounded-md border-t border-gray-700/50 bg-gray-950/50 px-2.5 py-2">
      <summary className="flex cursor-pointer list-none items-center justify-between text-[10px] font-medium uppercase text-teal-400">
        <span>{leg.action === "Pick up" ? "Teak Pick Up" : "Teak Drop Off"}</span>
        <span className="text-gray-500 transition-transform group-open:rotate-90">
          ▶
        </span>
      </summary>
      <div className="mt-2 space-y-1.5">
        <Row label="Location" value={display(leg.location)} />
        <Row label="Time" value={display(leg.time)} />
        <Row label="Companion" value={display(leg.companion)} />
        <Row label="Companion Pre-Position" value={display(leg.companionPrePositionFlight)} />
        <Row label="Teak Flight" value={display(leg.teakFlight)} />
        <Row label="Companion Return" value={display(leg.companionReturnFlight)} />
      </div>
    </details>
  );
}
