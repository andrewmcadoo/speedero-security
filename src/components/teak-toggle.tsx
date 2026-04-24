"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { TravelLeg } from "@/types/schedule";
import { ConfirmDialog } from "./confirm-dialog";
import { TravelDetailsSection } from "./travel-details-section";

type Action = "Pick up" | "Drop off";

interface TeakToggleProps {
  date: string;
  initialPickup?: TravelLeg;
  initialDropoff?: TravelLeg;
  profileId: string;
}

const actionLabel = (a: Action): string =>
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

const fieldDefs = [
  { key: "location", label: "Location", column: "location" },
  { key: "time", label: "Time", column: "time" },
  { key: "companion", label: "Companion", column: "companion" },
  { key: "companionPrePositionFlight", label: "Companion Pre-Position Flight", column: "companion_pre_position_flight" },
  { key: "teakFlight", label: "Teak Flight", column: "teak_flight" },
  { key: "companionReturnFlight", label: "Companion Return Flight", column: "companion_return_flight" },
] as const;

type FieldKey = (typeof fieldDefs)[number]["key"];
type FieldState = Record<FieldKey, string>;

function toFieldState(leg?: TravelLeg): FieldState {
  return {
    location: leg?.location ?? "",
    time: leg?.time ?? "",
    companion: leg?.companion ?? "",
    companionPrePositionFlight: leg?.companionPrePositionFlight ?? "",
    teakFlight: leg?.teakFlight ?? "",
    companionReturnFlight: leg?.companionReturnFlight ?? "",
  };
}

function emptyLeg(date: string, action: Action): TravelLeg {
  return {
    date,
    action,
    location: "",
    time: "",
    companion: "",
    companionPrePositionFlight: "",
    teakFlight: "",
    companionReturnFlight: "",
  };
}

export function TeakToggle({ date, initialPickup, initialDropoff, profileId }: TeakToggleProps) {
  const [pickup, setPickup] = useState<TravelLeg | undefined>(initialPickup);
  const [dropoff, setDropoff] = useState<TravelLeg | undefined>(initialDropoff);
  const [pickupFields, setPickupFields] = useState<FieldState>(() => toFieldState(initialPickup));
  const [dropoffFields, setDropoffFields] = useState<FieldState>(() => toFieldState(initialDropoff));
  const [pickupFormOpen, setPickupFormOpen] = useState(false);
  const [dropoffFormOpen, setDropoffFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<Action | null>(null);
  const router = useRouter();

  useEffect(() => {
    setPickup(initialPickup);
    setPickupFields(toFieldState(initialPickup));
  }, [initialPickup]);

  useEffect(() => {
    setDropoff(initialDropoff);
    setDropoffFields(toFieldState(initialDropoff));
  }, [initialDropoff]);

  const slotFor = (action: Action) =>
    action === "Pick up"
      ? { leg: pickup, setLeg: setPickup, setFields: setPickupFields, setFormOpen: setPickupFormOpen }
      : { leg: dropoff, setLeg: setDropoff, setFields: setDropoffFields, setFormOpen: setDropoffFormOpen };

  const handleCreate = async (action: Action) => {
    if (saving) return;
    setSaving(true);
    const { setLeg, setFields, setFormOpen } = slotFor(action);
    const newLeg = emptyLeg(date, action);
    setLeg(newLeg);
    setFields(toFieldState(newLeg));
    setFormOpen(true);
    const supabase = createClient();
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
    setSaving(false);
  };

  const handleDelete = async (action: Action) => {
    if (saving) return;
    setSaving(true);
    const { leg, setLeg, setFormOpen } = slotFor(action);
    const prev = leg;
    setLeg(undefined);
    setFormOpen(false);
    const supabase = createClient();
    const { error } = await supabase
      .from("travel_legs")
      .delete()
      .eq("date", date)
      .eq("action", action);
    if (error) {
      console.error("Delete travel leg failed:", error.message, error.code, error.details, error.hint);
      setLeg(prev);
    } else {
      router.refresh();
    }
    setSaving(false);
  };

  const handleSave = async (action: Action) => {
    if (saving) return;
    const { leg, setLeg, setFormOpen } = slotFor(action);
    if (!leg) return;
    setSaving(true);
    const fields = action === "Pick up" ? pickupFields : dropoffFields;

    const updatePayload: Record<string, string> = { updated_at: new Date().toISOString() };
    for (const def of fieldDefs) {
      updatePayload[def.column] = fields[def.key];
    }

    const prev = leg;
    setLeg({ ...leg, ...fields });

    const supabase = createClient();
    const { error } = await supabase
      .from("travel_legs")
      .update(updatePayload)
      .eq("date", date)
      .eq("action", action);
    if (error) {
      console.error("Save travel leg failed:", error.message, error.code, error.details, error.hint);
      setLeg(prev);
    } else {
      router.refresh();
      setFormOpen(false);
    }
    setSaving(false);
  };

  function handleCancel(action: Action) {
    const { leg, setFields, setFormOpen } = slotFor(action);
    if (!leg) return;
    setFields(toFieldState(leg));
    setFormOpen(false);
  }

  function onButtonTap(action: Action) {
    if (saving) return;
    const { leg } = slotFor(action);
    if (!leg) {
      void handleCreate(action);
      return;
    }
    if (!legHasAnyField(leg)) {
      void handleDelete(action);
      return;
    }
    setPendingRemoval(action);
  }

  function confirmPending() {
    if (!pendingRemoval) return;
    const action = pendingRemoval;
    setPendingRemoval(null);
    void handleDelete(action);
  }

  const cancelPending = useCallback(() => {
    setPendingRemoval(null);
  }, []);

  const isPickUp = pickup !== undefined;
  const isDropOff = dropoff !== undefined;

  return (
    <div className="border-t border-gray-700 pt-2.5">
      <div className="mb-1.5">
        <span className="text-[10px] text-gray-500">TEAK</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => onButtonTap("Pick up")}
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
          onClick={() => onButtonTap("Drop off")}
          disabled={saving}
          className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
            isDropOff
              ? "bg-rose-900/60 text-rose-300"
              : "border border-gray-600 text-gray-500 hover:border-rose-700 hover:text-rose-400"
          } disabled:opacity-50`}
        >
          Drop Off
        </button>
      </div>

      <LegSection
        leg={pickup}
        formOpen={pickupFormOpen}
        fields={pickupFields}
        setFields={setPickupFields}
        onEdit={() => setPickupFormOpen(true)}
        onCancel={() => handleCancel("Pick up")}
        onSave={() => handleSave("Pick up")}
        saving={saving}
      />
      <LegSection
        leg={dropoff}
        formOpen={dropoffFormOpen}
        fields={dropoffFields}
        setFields={setDropoffFields}
        onEdit={() => setDropoffFormOpen(true)}
        onCancel={() => handleCancel("Drop off")}
        onSave={() => handleSave("Drop off")}
        saving={saving}
      />

      {pendingRemoval && (
        <ConfirmDialog
          open={true}
          title={`Remove ${actionLabel(pendingRemoval)}?`}
          body="This will delete the location, time, companion, and flight details you've entered for this date."
          confirmLabel={`Remove ${actionLabel(pendingRemoval)}`}
          variant="destructive"
          onConfirm={confirmPending}
          onCancel={cancelPending}
        />
      )}
    </div>
  );
}

function LegSection({
  leg,
  formOpen,
  fields,
  setFields,
  onEdit,
  onCancel,
  onSave,
  saving,
}: {
  leg: TravelLeg | undefined;
  formOpen: boolean;
  fields: FieldState;
  setFields: (updater: (prev: FieldState) => FieldState) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  if (!leg) return null;

  if (!formOpen) {
    return (
      <div className="mt-2">
        <TravelDetailsSection
          leg={leg}
          footer={
            <button
              onClick={onEdit}
              className="text-[10px] text-teal-400 hover:text-teal-300"
            >
              Edit
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-md bg-gray-950/50 p-2.5">
      <div className="text-[10px] font-medium uppercase text-teal-400">
        {leg.action === "Pick up" ? "Teak Pick Up" : "Teak Drop Off"}
      </div>
      {fieldDefs.map((def) => (
        <TeakField
          key={def.key}
          label={def.label}
          value={fields[def.key]}
          onChange={(value) => setFields((prev) => ({ ...prev, [def.key]: value }))}
        />
      ))}
      <div className="mt-1 flex gap-2">
        <button
          onClick={onCancel}
          disabled={saving}
          className="shrink-0 rounded border border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:border-gray-500 hover:text-gray-200 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          className="flex-1 rounded bg-teal-700 px-3 py-1.5 text-xs font-medium text-teal-100 transition-colors hover:bg-teal-600 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
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
