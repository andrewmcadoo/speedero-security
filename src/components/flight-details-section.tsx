import type { DashboardEntry } from "@/types/schedule";

const labelClass = "text-[10px] text-gray-500 mb-0.5";
const valueClass = "text-xs text-gray-100";

function display(value: string): string {
  return value === "" ? "—" : value;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className={`${labelClass} min-w-[110px] shrink-0 uppercase`}>
        {label}
      </div>
      <div className={valueClass}>{value}</div>
    </div>
  );
}

export function FlightDetailsSection({ entry }: { entry: DashboardEntry }) {
  const { departure, arrival } = entry;
  const hasAny =
    departure.airport ||
    departure.fbo ||
    departure.time ||
    arrival.airport ||
    arrival.fbo ||
    arrival.time;
  if (!hasAny) return null;

  return (
    <details className="group rounded-md border-t border-gray-700/50 bg-gray-950/50 px-2.5 py-2">
      <summary className="flex cursor-pointer list-none items-center justify-between text-[10px] font-medium uppercase text-amber-400">
        <span>Greg Flight Details</span>
        <span className="text-gray-500 transition-transform group-open:rotate-90">
          ▶
        </span>
      </summary>
      <div className="mt-2 grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <div className="text-[10px] font-medium text-amber-400">DEPARTURE</div>
          <Row label="Airport" value={display(departure.airport)} />
          <Row label="FBO" value={display(departure.fbo)} />
          <Row label="Wheels Up" value={display(departure.time)} />
        </div>
        <div className="space-y-1.5">
          <div className="text-[10px] font-medium text-amber-400">ARRIVAL</div>
          <Row label="Airport" value={display(arrival.airport)} />
          <Row label="FBO" value={display(arrival.fbo)} />
          <Row
            label="Wheels Down"
            value={
              arrival.time ? `${arrival.time} (local)` : "—"
            }
          />
        </div>
      </div>
    </details>
  );
}
