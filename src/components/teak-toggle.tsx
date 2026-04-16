"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { TravelLeg } from "@/types/schedule";
import { ConfirmDialog } from "./confirm-dialog";

interface TeakToggleProps {
  date: string;
  initialLeg?: TravelLeg;
  initialTeakNight: boolean;
  profileId: string;
}

type PendingAction =
  | { kind: "unset"; action: "Pick up" | "Drop off" }
  | {
      kind: "switch";
      from: "Pick up" | "Drop off";
      to: "Pick up" | "Drop off";
    };

const actionLabel = (a: "Pick up" | "Drop off"): string =>
  a === "Pick up" ? "Pick Up" : "Drop Off";

function legHasAnyField(leg: TravelLeg): boolean {
  return [
    leg.location,
    leg.time,
    leg.companion,
    leg.companionPrePositionFlight,
    leg.teakFlight,
    leg.companionReturnFlight,
  ].some((v) => v.trim() !== "");
}

interface DialogCopy {
  title: string;
  body: string;
  confirmLabel: string;
  variant: "destructive" | "neutral";
}

function dialogCopy(pending: PendingAction): DialogCopy {
  if (pending.kind === "unset") {
    const label = actionLabel(pending.action);
    return {
      title: `Remove ${label}?`,
      body:
        "This will delete the location, time, companion, and flight details you've entered for this date.",
      confirmLabel: `Remove ${label}`,
      variant: "destructive",
    };
  }
  return {
    title: `Change ${actionLabel(pending.from)} to ${actionLabel(pending.to)}?`,
    body: "The location, time, companion, and flight details will be kept.",
    confirmLabel: `Change to ${actionLabel(pending.to)}`,
    variant: "neutral",
  };
}

const fieldDefs = [
  { key: "location", label: "Location", column: "location" },
  { key: "time", label: "Time", column: "time" },
  { key: "companion", label: "Companion", column: "companion" },
  { key: "companionPrePositionFlight", label: "Companion Pre-Position Flight", column: "companion_pre_position_flight" },
  { key: "teakFlight", label: "Teak Flight", column: "teak_flight" },
  { key: "companionReturnFlight", label: "Companion Return Flight", column: "companion_return_flight" },
] as const;

type FieldKey = (typeof fieldDefs)[number]["key"];

function toFieldState(leg?: TravelLeg): Record<FieldKey, string> {
  return {
    location: leg?.location ?? "",
    time: leg?.time ?? "",
    companion: leg?.companion ?? "",
    companionPrePositionFlight: leg?.companionPrePositionFlight ?? "",
    teakFlight: leg?.teakFlight ?? "",
    companionReturnFlight: leg?.companionReturnFlight ?? "",
  };
}

export function TeakToggle({ date, initialLeg, initialTeakNight, profileId }: TeakToggleProps) {
  const [leg, setLeg] = useState<TravelLeg | undefined>(initialLeg);
  const [fields, setFields] = useState<Record<FieldKey, string>>(() => toFieldState(initialLeg));
  const [teakNight, setTeakNight] = useState(initialTeakNight);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const router = useRouter();

  useEffect(() => {
    setLeg(initialLeg);
    setFields(toFieldState(initialLeg));
  }, [initialLeg]);

  useEffect(() => {
    setTeakNight(initialTeakNight);
  }, [initialTeakNight]);

  const handleTeakNightToggle = async () => {
    if (saving) return;
    const newValue = !teakNight;
    const prev = teakNight;
    setTeakNight(newValue);

    const supabase = createClient();
    const { error } = await supabase.from("date_settings").upsert(
      {
        date,
        teak_night: newValue,
        updated_by: profileId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "date" }
    );
    if (error) {
      console.error("Teak night toggle failed:", error.message, error.code, error.details, error.hint);
      setTeakNight(prev);
    } else {
      router.refresh();
    }
  };

  const handleToggle = async (action: "Pick up" | "Drop off") => {
    if (saving) return;
    setSaving(true);
    const supabase = createClient();

    if (leg?.action === action) {
      const prev = leg;
      setLeg(undefined);
      setFormOpen(false);
      const { error } = await supabase
        .from("travel_legs")
        .delete()
        .eq("date", date);
      if (error) {
        console.error("Delete travel leg failed:", error.message, error.code, error.details, error.hint);
        setLeg(prev);
      } else {
        router.refresh();
      }
    } else if (leg) {
      const prev = leg;
      setLeg({ ...leg, action });
      setFormOpen(true);
      const { error } = await supabase
        .from("travel_legs")
        .update({ action, updated_at: new Date().toISOString() })
        .eq("date", date);
      if (error) {
        console.error("Update travel leg action failed:", error.message, error.code, error.details, error.hint);
        setLeg(prev);
      } else {
        router.refresh();
      }
    } else {
      const newLeg: TravelLeg = {
        date,
        action,
        location: "",
        time: "",
        companion: "",
        companionPrePositionFlight: "",
        teakFlight: "",
        companionReturnFlight: "",
      };
      setLeg(newLeg);
      setFields(toFieldState(newLeg));
      setFormOpen(true);
      const { error } = await supabase.from("travel_legs").insert({
        date,
        action,
        created_by: profileId,
      });
      if (error) {
        console.error("Insert travel leg failed:", error.message, error.code, error.details, error.hint);
        setLeg(undefined);
        setFormOpen(false);
      } else {
        router.refresh();
      }
    }
    setSaving(false);
  };

  const handleSave = async () => {
    if (!leg || saving) return;
    setSaving(true);

    const updatePayload: Record<string, string> = { updated_at: new Date().toISOString() };
    for (const def of fieldDefs) {
      updatePayload[def.column] = fields[def.key];
    }

    const prev = leg;
    const updatedLeg = { ...leg, ...fields };
    setLeg(updatedLeg);

    const supabase = createClient();
    const { error } = await supabase
      .from("travel_legs")
      .update(updatePayload)
      .eq("date", date);
    if (error) {
      console.error("Save travel leg failed:", error.message, error.code, error.details, error.hint);
      setLeg(prev);
    } else {
      router.refresh();
      setFormOpen(false);
    }
    setSaving(false);
  };

  function onPickUpOrDropOffTap(tapped: "Pick up" | "Drop off") {
    if (saving) return;
    if (!leg) {
      void handleToggle(tapped);
      return;
    }
    if (leg.action === tapped) {
      if (!legHasAnyField(leg)) {
        void handleToggle(tapped);
        return;
      }
      setPendingAction({ kind: "unset", action: tapped });
      return;
    }
    setPendingAction({ kind: "switch", from: leg.action, to: tapped });
  }

  function confirmPending() {
    if (!pendingAction) return;
    const tapped =
      pendingAction.kind === "unset" ? pendingAction.action : pendingAction.to;
    setPendingAction(null);
    void handleToggle(tapped);
  }

  const cancelPending = useCallback(() => {
    setPendingAction(null);
  }, []);

  const isPickUp = leg?.action === "Pick up";
  const isDropOff = leg?.action === "Drop off";
  const dialogCopyResolved = pendingAction ? dialogCopy(pendingAction) : null;

  return (
    <div className="border-t border-gray-700 pt-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] text-gray-500">TEAK</span>
        {leg && !formOpen && (
          <button
            onClick={() => setFormOpen(true)}
            className="text-[10px] text-teal-400 hover:text-teal-300"
          >
            Edit
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => onPickUpOrDropOffTap("Pick up")}
          disabled={saving}
          className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
            isPickUp
              ? "bg-green-900/60 text-green-300"
              : "border border-gray-600 text-gray-500 hover:border-green-700 hover:text-green-400"
          } disabled:opacity-50`}
        >
          Pick Up
        </button>
        <button
          onClick={() => onPickUpOrDropOffTap("Drop off")}
          disabled={saving}
          className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
            isDropOff
              ? "bg-rose-900/60 text-rose-300"
              : "border border-gray-600 text-gray-500 hover:border-rose-700 hover:text-rose-400"
          } disabled:opacity-50`}
        >
          Drop Off
        </button>
        <button
          onClick={handleTeakNightToggle}
          disabled={saving}
          className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
            teakNight
              ? "bg-purple-900/60 text-purple-300"
              : "border border-gray-600 text-gray-500 hover:border-purple-700 hover:text-purple-400"
          } disabled:opacity-50`}
        >
          Teak Night
        </button>
      </div>

      {leg && formOpen && (
        <div className="mt-2 space-y-2 rounded-md bg-gray-950/50 p-2.5">
          {fieldDefs.map((def) => (
            <TeakField
              key={def.key}
              label={def.label}
              value={fields[def.key]}
              onChange={(value) => setFields((prev) => ({ ...prev, [def.key]: value }))}
            />
          ))}
          <button
            onClick={handleSave}
            disabled={saving}
            className="mt-1 w-full rounded bg-teal-700 px-3 py-1.5 text-xs font-medium text-teal-100 transition-colors hover:bg-teal-600 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}
      {dialogCopyResolved && (
        <ConfirmDialog
          open={true}
          title={dialogCopyResolved.title}
          body={dialogCopyResolved.body}
          confirmLabel={dialogCopyResolved.confirmLabel}
          variant={dialogCopyResolved.variant}
          onConfirm={confirmPending}
          onCancel={cancelPending}
        />
      )}
    </div>
  );
}

function TeakField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <div className="mb-0.5 text-[10px] text-gray-500">{label}</div>
      <input
        type="text"
        className="w-full rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-100 focus:border-blue-500 focus:outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
