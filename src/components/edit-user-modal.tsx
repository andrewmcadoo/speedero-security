"use client";

import { useActionState, useState } from "react";
import { editUser, deleteUser, resetUserPassword } from "@/app/admin/users/actions";

interface EditUserModalProps {
  user: { id: string; full_name: string; email: string; role: "epo" | "management" };
  currentUserId: string;
  open: boolean;
  onClose: () => void;
}

export function EditUserModal({
  user,
  currentUserId,
  open,
  onClose,
}: EditUserModalProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);

  const [editState, editAction, editPending] = useActionState(
    async (
      prev: { error?: string; success?: boolean } | null,
      formData: FormData
    ) => {
      const result = await editUser(prev, formData);
      if (result.success) onClose();
      return result;
    },
    null
  );

  const [resetState, resetAction, resetPending] = useActionState(
    async (
      prev: { error?: string; success?: boolean } | null,
      formData: FormData
    ) => {
      const result = await resetUserPassword(prev, formData);
      if (result.success) onClose();
      return result;
    },
    null
  );

  const [deleteState, deleteAction, deletePending] = useActionState(
    async (
      prev: { error?: string; success?: boolean } | null,
      formData: FormData
    ) => {
      const result = await deleteUser(prev, formData);
      if (result.success) onClose();
      return result;
    },
    null
  );

  if (!open) return null;

  const isSelf = user.id === currentUserId;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl bg-gray-900 p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold text-gray-100">Edit User</h2>

        <form action={editAction} className="space-y-3">
          <input type="hidden" name="userId" value={user.id} />
          <div>
            <label className="mb-1 block text-xs text-gray-400">
              Full Name
            </label>
            <input
              name="fullName"
              type="text"
              required
              defaultValue={user.full_name}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-400">Email</label>
            <input
              name="email"
              type="email"
              required
              defaultValue={user.email}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-400">Role</label>
            <select
              name="role"
              defaultValue={user.role}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
            >
              <option value="epo">EPO</option>
              <option value="management">Management</option>
            </select>
          </div>

          {editState?.error && (
            <p className="text-xs text-red-400">{editState.error}</p>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={editPending}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {editPending ? "Saving..." : "Save Changes"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-gray-400 transition-colors hover:text-gray-200"
            >
              Cancel
            </button>
          </div>
        </form>

        <div className="mt-6 border-t border-gray-800 pt-4">
          {!showResetPassword ? (
            <button
              type="button"
              onClick={() => setShowResetPassword(true)}
              className="text-sm text-amber-400 transition-colors hover:text-amber-300"
            >
              {isSelf ? "Change password" : "Reset password"}
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-gray-400">
                {isSelf
                  ? "Set a new password. It will take effect on your next sign-in."
                  : "Set a temporary password. The user will be required to change it on their next login."}
              </p>
              <form action={resetAction} className="space-y-2">
                <input type="hidden" name="userId" value={user.id} />
                <input
                  name="password"
                  type="password"
                  required
                  minLength={6}
                  placeholder={isSelf ? "New password (6+ chars)" : "Temporary password (6+ chars)"}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-amber-500 focus:outline-none"
                />
                {resetState?.error && (
                  <p className="text-xs text-red-400">{resetState.error}</p>
                )}
                {resetState?.success && (
                  <p className="text-xs text-green-400">
                    {isSelf ? "Password changed successfully" : "Password reset successfully"}
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={resetPending}
                    className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
                  >
                    {resetPending
                      ? (isSelf ? "Changing..." : "Resetting...")
                      : (isSelf ? "Change Password" : "Reset Password")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowResetPassword(false)}
                    className="rounded-lg px-4 py-2 text-sm text-gray-400 transition-colors hover:text-gray-200"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>

        {!isSelf && (
          <div className="mt-4 border-t border-gray-800 pt-4">
            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="text-sm text-red-400 transition-colors hover:text-red-300"
              >
                Delete user
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-gray-400">
                  This will permanently delete this user and all their schedule
                  assignments.
                </p>
                {deleteState?.error && (
                  <p className="text-xs text-red-400">{deleteState.error}</p>
                )}
                <div className="flex gap-2">
                  <form action={deleteAction}>
                    <input type="hidden" name="userId" value={user.id} />
                    <button
                      type="submit"
                      disabled={deletePending}
                      className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                    >
                      {deletePending ? "Deleting..." : "Confirm Delete"}
                    </button>
                  </form>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="rounded-lg px-4 py-2 text-sm text-gray-400 transition-colors hover:text-gray-200"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
