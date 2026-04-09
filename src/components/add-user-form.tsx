"use client";

import { useActionState, useState } from "react";
import { addUser } from "@/app/admin/users/actions";

export function AddUserForm() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (
      prev: { error?: string; success?: boolean } | null,
      formData: FormData
    ) => {
      const result = await addUser(prev, formData);
      if (result.success) setOpen(false);
      return result;
    },
    null
  );

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-lg border border-dashed border-gray-700 px-4 py-3 text-sm text-gray-400 transition-colors hover:border-gray-500 hover:text-gray-200"
      >
        + Add User
      </button>
    );
  }

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-lg bg-gray-800/80 p-4"
    >
      <div className="space-y-2">
        <input
          name="email"
          type="email"
          required
          placeholder="Email"
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
        />
        <input
          name="password"
          type="password"
          required
          minLength={6}
          placeholder="Password"
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
        />
        <input
          name="fullName"
          type="text"
          placeholder="Full name"
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
        />
        <select
          name="role"
          defaultValue="epo"
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
        >
          <option value="epo">EPO</option>
          <option value="management">Management</option>
        </select>
      </div>
      {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? "Adding..." : "Add User"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg px-4 py-2 text-sm text-gray-400 transition-colors hover:text-gray-200"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
