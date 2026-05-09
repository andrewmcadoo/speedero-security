"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SopsList } from "@/components/sops-list";
import { SopUploadForm } from "@/components/sop-upload-form";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { uploadSop, updateSop, deleteSop } from "./actions";
import type { Sop } from "@/types/sops";

interface Props {
  sops: Sop[];
  isManagement: boolean;
  uploadersById: Record<string, string>;
}

export function SopsPageClient({ sops, isManagement, uploadersById }: Props) {
  const router = useRouter();
  const [pendingEdit, setPendingEdit] = useState<Sop | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Sop | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  return (
    <>
      <SopsList
        sops={sops}
        isManagement={isManagement}
        uploadersById={uploadersById}
        onRequestUpload={() => setUploadOpen(true)}
        onRequestEdit={(sop) => setPendingEdit(sop)}
        onRequestDelete={(sop) => {
          setDeleteError(null);
          setPendingDelete(sop);
        }}
      />

      <SopUploadForm
        open={uploadOpen}
        mode="create"
        onCancel={() => setUploadOpen(false)}
        onSubmit={async (fd) => {
          const res = await uploadSop(fd);
          if (res.ok) router.refresh();
          return res;
        }}
      />

      <SopUploadForm
        open={pendingEdit !== null}
        mode="edit"
        initial={pendingEdit ?? undefined}
        onCancel={() => setPendingEdit(null)}
        onSubmit={async (fd) => {
          if (!pendingEdit) return { ok: false, error: "No SOP selected" };
          const res = await updateSop(pendingEdit.id, fd);
          if (res.ok) router.refresh();
          return res;
        }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete SOP?"
        body={
          pendingDelete
            ? `"${pendingDelete.title}" will be removed from the list. The audit log retains a permanent record of the deletion and the file remains in storage.`
            : ""
        }
        confirmLabel="Delete"
        variant="destructive"
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (!pendingDelete) return;
          const res = await deleteSop(pendingDelete.id);
          if (!res.ok) {
            setDeleteError(res.error);
            return;
          }
          setPendingDelete(null);
          router.refresh();
        }}
      />
      {deleteError && (
        <p className="fixed bottom-3 left-1/2 z-50 -translate-x-1/2 rounded bg-red-900 px-3 py-2 text-sm text-red-100">
          {deleteError}
        </p>
      )}
    </>
  );
}
