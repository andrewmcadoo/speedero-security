import type { Principal, Transition } from "@/types/schedule";
import { formatTimeInTz } from "@/lib/schedule-utils";

interface TransitionsSectionProps {
  transitions: Transition[];
}

const GROUPS: { person: Principal; label: string }[] = [
  { person: "greg", label: "Greg" },
  { person: "krista", label: "Krista" },
];

export function TransitionsSection({ transitions }: TransitionsSectionProps) {
  if (transitions.length === 0) return null;

  const visible = GROUPS.map(({ person, label }) => ({
    person,
    label,
    items: transitions.filter((t) => t.person === person),
  })).filter((g) => g.items.length > 0);

  if (visible.length === 0) return null;

  return (
    <div className="space-y-3">
      {visible.map(({ person, label, items }) => (
        <div key={person}>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">
            {label}
          </div>
          <ul className="space-y-1">
            {items.map((t) => (
              <li key={t.eventId} className="flex items-baseline gap-2">
                <span className="shrink-0 font-mono text-[11px] text-gray-400">
                  {formatTimeInTz(t.startsAt, t.tz)}
                </span>
                <span className="text-xs text-gray-100">{t.title}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
