"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { TravelLeg } from "@/types/schedule";

interface TeakToggleProps {
  date: string;
  initialLeg?: TravelLeg;
  profileId: string;
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

export function TeakToggle({ date, initialLeg, profileId }: TeakToggleProps) {
  const [leg, setLeg] = useState<TravelLeg | undefined>(initialLeg);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setLeg(initialLeg);
  }, [initialLeg]);

  const handleToggle = async (action: "Pick up" | "Drop off") => {
    if (saving) return;
    setSaving(true);
    const supabase = createClient();

    if (leg?.action === action) {
      const prev = leg;
      setLeg(undefined);
      const { error } = await supabase
        .from("travel_legs")
        .delete()
        .eq("date", date);
      if (error) {
        console.error("Delete travel leg failed:", error);
        setLeg(prev);
      } else {
        router.refresh();
      }
    } else if (leg) {
      const prev = leg;
      setLeg({ ...leg, action });
      const { error } = await supabase
        .from("travel_legs")
        .update({ action, updated_at: new Date().toISOString() })
        .eq("date", date);
      if (error) {
        console.error("Update travel leg action failed:", error);
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
      const { error } = await supabase.from("travel_legs").insert({
        date,
        action,
        created_by: profileId,
      });
      if (error) {
        console.error("Insert travel leg failed:", error);
        setLeg(undefined);
      } else {
        router.refresh();
      }
    }
    setSaving(false);
  };

  const handleFieldBlur = async (fieldKey: FieldKey, value: string) => {
    if (!leg) return;
    const def = fieldDefs.find((f) => f.key === fieldKey);
    if (!def) return;

    const prev = leg;
    setLeg({ ...leg, [fieldKey]: value });

    const supabase = createClient();
    const { error } = await supabase
      .from("travel_legs")
      .update({ [def.column]: value, updated_at: new Date().toISOString() })
      .eq("date", date);
    if (error) {
      console.error(`Update ${def.column} failed:`, error);
      setLeg(prev);
    } else {
      router.refresh();
    }
  };

  const isPickUp = leg?.action === "Pick up";
  const isDropOff = leg?.action === "Drop off";

  return (
    <div className="border-t border-gray-700 pt-2.5">
      <div className="mb-1.5 text-[10px] text-gray-500">TEAK</div>
      <div className="flex gap-1.5">
        <button
          onClick={() => handleToggle("Pick up")}
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
          onClick={() => handleToggle("Drop off")}
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

      {leg && (
        <div className="mt-2 space-y-2 rounded-md bg-gray-950/50 p-2.5">
          {fieldDefs.map((def) => (
            <TeakField
              key={def.key}
              label={def.label}
              value={leg[def.key]}
              onBlur={(value) => handleFieldBlur(def.key, value)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TeakField({
  label,
  value,
  onBlur,
}: {
  label: string;
  value: string;
  onBlur: (value: string) => void;
}) {
  const [local, setLocal] = useState(value);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  return (
    <div>
      <div className="mb-0.5 text-[10px] text-gray-500">{label}</div>
      <input
        type="text"
        className="w-full rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-100 focus:border-blue-500 focus:outline-none"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          if (local !== value) onBlur(local);
        }}
      />
    </div>
  );
}
