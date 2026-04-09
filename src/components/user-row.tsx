"use client";

import { useState } from "react";
import { EditUserModal } from "./edit-user-modal";

interface UserRowProps {
  user: {
    id: string;
    full_name: string;
    email: string;
    role: "epo" | "management";
  };
  currentUserId: string;
}

export function UserRow({ user, currentUserId }: UserRowProps) {
  const [editing, setEditing] = useState(false);

  return (
    <>
      <div className="flex items-center justify-between rounded-lg bg-gray-800/80 px-4 py-3">
        <div>
          <div className="text-sm font-medium text-gray-100">
            {user.full_name || "Unnamed"}
          </div>
          <div className="text-xs text-gray-500">{user.email}</div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              user.role === "management"
                ? "bg-blue-900/60 text-blue-400"
                : "bg-gray-800 text-gray-400"
            }`}
          >
            {user.role === "management" ? "Management" : "EPO"}
          </span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-lg px-2 py-1 text-xs text-gray-500 transition-colors hover:text-gray-200"
          >
            Edit
          </button>
        </div>
      </div>
      <EditUserModal
        user={user}
        currentUserId={currentUserId}
        open={editing}
        onClose={() => setEditing(false)}
      />
    </>
  );
}
