"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getEpoColor } from "@/lib/epo-colors";

interface EpoInfo {
  id: string;
  fullName: string;
  email: string;
}

export function EpoAssignment({
  date,
  assignedEpos: initialAssigned,
  allEpos,
  profileId,
}: {
  date: string;
  assignedEpos: EpoInfo[];
  allEpos: EpoInfo[];
  profileId: string;
}) {
  const [assigned, setAssigned] = useState(initialAssigned);
  const [showDropdown, setShowDropdown] = useState(false);
  const router = useRouter();

  // Sync local state when server data changes (e.g. after router.refresh())
  useEffect(() => {
    setAssigned(initialAssigned);
  }, [initialAssigned]);

  const unassigned = allEpos.filter(
    (epo) => !assigned.some((a) => a.id === epo.id)
  );

  const handleAssign = async (epo: EpoInfo) => {
    // Optimistic update
    const prev = assigned;
    setAssigned([...assigned, epo]);
    setShowDropdown(false);

    const supabase = createClient();
    const { error } = await supabase.from("assignments").insert({
      date,
      epo_id: epo.id,
      assigned_by: profileId,
    });
    if (error) {
      console.error("Assignment failed:", error.message, error.code, error.details, error.hint);
      setAssigned(prev); // Revert
    } else {
      router.refresh();
    }
  };

  const handleRemove = async (epoId: string) => {
    // Optimistic update
    const prev = assigned;
    setAssigned(assigned.filter((a) => a.id !== epoId));

    const supabase = createClient();
    const { error } = await supabase
      .from("assignments")
      .delete()
      .eq("date", date)
      .eq("epo_id", epoId);
    if (error) {
      console.error("Remove assignment failed:", error);
      setAssigned(prev); // Revert
    } else {
      router.refresh();
    }
  };

  return (
    <div className="border-t border-gray-700 pt-2.5">
      <div className="mb-1.5 text-[10px] text-gray-500">ASSIGNED EPOs</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {assigned.map((epo) => {
          const color = getEpoColor(epo.id);
          return (
            <span
              key={epo.id}
              className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${color.bg} ${color.text}`}
            >
              {epo.fullName || epo.email}
              <button
                onClick={() => handleRemove(epo.id)}
                className="opacity-60 transition-opacity hover:opacity-100"
              >
                &times;
              </button>
            </span>
          );
        })}

        <div className="relative">
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            disabled={unassigned.length === 0}
            className="rounded-full border border-dashed border-gray-600 px-2.5 py-1 text-xs text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-300 disabled:opacity-30"
          >
            + Assign
          </button>

          {showDropdown && unassigned.length > 0 && (
            <div className="absolute top-full left-0 z-10 mt-1 w-48 rounded-md bg-gray-900 py-1 shadow-lg ring-1 ring-gray-700">
              {unassigned.map((epo) => (
                <button
                  key={epo.id}
                  onClick={() => handleAssign(epo)}
                  className="block w-full px-3 py-1.5 text-left text-xs text-gray-300 transition-colors hover:bg-gray-800"
                >
                  {epo.fullName || epo.email}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
