"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { updatePassword } from "./actions";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [mismatch, setMismatch] = useState(false);

  const [state, formAction, pending] = useActionState(
    async (
      prev: { error?: string; success?: boolean } | null,
      formData: FormData
    ) => {
      const password = formData.get("password") as string;
      if (password !== confirm) {
        setMismatch(true);
        return prev;
      }
      setMismatch(false);

      const result = await updatePassword(prev, formData);
      if (result.success) {
        const supabase = createClient();
        await supabase.auth.refreshSession();
        router.push("/dashboard");
      }
      return result;
    },
    null
  );

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm space-y-6 px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">
            Set Your Password
          </h1>
          <p className="mt-2 text-sm text-gray-400">
            Choose a new password for your account
          </p>
        </div>

        <form action={formAction} className="space-y-4">
          <input
            name="password"
            type="password"
            required
            minLength={6}
            placeholder="New password"
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 text-sm text-white placeholder-gray-400 focus:border-blue-500 focus:outline-none"
          />
          <input
            type="password"
            required
            minLength={6}
            placeholder="Confirm password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              setMismatch(false);
            }}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 text-sm text-white placeholder-gray-400 focus:border-blue-500 focus:outline-none"
          />

          {mismatch && (
            <p className="text-xs text-red-400">Passwords do not match</p>
          )}
          {state?.error && (
            <p className="text-xs text-red-400">{state.error}</p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {pending ? "Saving..." : "Set Password"}
          </button>
        </form>
      </div>
    </div>
  );
}
