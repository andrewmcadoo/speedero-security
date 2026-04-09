"use client";

import { useState } from "react";
import type { DashboardEntry } from "@/types/schedule";
import { statusBorderColor } from "./status-badge";
import { CoverageBadge } from "./coverage-badge";
import { DETAIL_LEVEL_LABELS } from "@/lib/detail-levels";
import { getEpoColor } from "@/lib/epo-colors";

const labelClass = "text-[10px] text-gray-500 mb-0.5";

function ReadOnlyField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  if (!value) return null;
  return (
    <div>
      <div className={labelClass}>{label}</div>
      <div className="text-xs text-gray-100">{value}</div>
    </div>
  );
}

export function ScheduleDetailCard({ entry }: { entry: DashboardEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`rounded-lg border-l-3 bg-gray-800/80 ${statusBorderColor(entry.confirmationStatus)}`}
    >
      {/* Collapsed header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between p-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold text-gray-100">
              {entry.activity || "No activity listed"}
            </h3>
            {entry.teakNight && (
              <span className="shrink-0 rounded bg-purple-900/60 px-1.5 py-0.5 text-[10px] font-medium text-purple-300">
                TEAK NIGHT
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-gray-400">{entry.location}</p>
          {entry.assignedEpos.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {entry.assignedEpos.map((epo) => (
                <span
                  key={epo.id}
                  className={`rounded px-1.5 py-0.5 text-[10px] ${getEpoColor(epo.id).bg} ${getEpoColor(epo.id).text}`}
                >
                  {epo.fullName}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="ml-3 flex items-center gap-3">
          <div className="text-center">
            <div className="text-[10px] text-gray-500">DETAIL</div>
            <div className="text-sm font-bold text-gray-100">
              {DETAIL_LEVEL_LABELS[entry.detailLevel]}
            </div>
          </div>
          <div className="text-center">
            <div className="text-[10px] text-gray-500">EPOs</div>
            <CoverageBadge
              assigned={entry.assignedEpos.length}
              detailLevel={entry.detailLevel}
            />
          </div>
          <span className="text-gray-500">
            {expanded ? "▼" : "▶"}
          </span>
        </div>
      </button>

      {/* Expanded details — read-only */}
      {expanded && (
        <div className="space-y-3 border-t border-gray-700/50 px-3 pb-3 pt-3">
          <div className="grid grid-cols-1 gap-2 rounded-md bg-gray-950/50 p-2.5 sm:grid-cols-3">
            <ReadOnlyField label="ACTIVITY" value={entry.activity} />
            <ReadOnlyField label="NIGHT LOCATION" value={entry.location} />
            <ReadOnlyField label="LODGING" value={entry.lodging} />
          </div>

          {!!(entry.departure.airport || entry.departure.time || entry.arrival.airport || entry.arrival.time) && (
            <div className="grid grid-cols-2 gap-2 rounded-md bg-gray-950/50 p-2.5">
              <div className="space-y-1.5">
                <div className="text-[10px] font-medium text-amber-400">DEPARTURE</div>
                <ReadOnlyField label="AIRPORT" value={entry.departure.airport} />
                <ReadOnlyField label="FBO" value={entry.departure.fbo} />
                <ReadOnlyField label="WHEELS UP" value={entry.departure.time} />
              </div>
              <div className="space-y-1.5">
                <div className="text-[10px] font-medium text-amber-400">ARRIVAL</div>
                <ReadOnlyField label="AIRPORT" value={entry.arrival.airport} />
                <ReadOnlyField label="FBO" value={entry.arrival.fbo} />
                {entry.arrival.time ? (
                  <div>
                    <div className="text-[10px] text-gray-500">WHEELS DOWN</div>
                    <div className="text-xs text-gray-100">
                      {entry.arrival.time}
                      <span className="ml-1 text-[10px] text-gray-500">(local)</span>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          <div>
            <div className={labelClass}>DETAIL</div>
            <div className="text-sm font-bold text-gray-100">
              {DETAIL_LEVEL_LABELS[entry.detailLevel]}
            </div>
          </div>

          {entry.assignedEpos.length > 0 && (
            <div>
              <div className={labelClass}>ASSIGNED EPOs</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {entry.assignedEpos.map((epo) => {
                  const color = getEpoColor(epo.id);
                  return (
                    <span
                      key={epo.id}
                      className={`rounded px-2 py-0.5 text-xs ${color.bg} ${color.text}`}
                    >
                      {epo.fullName}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
