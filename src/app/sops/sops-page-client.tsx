"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SopsList } from "@/components/sops-list";
import { SopUploadForm } from "@/components/sop-upload-form";
import { uploadSop, updateSop } from "./actions";
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

  return (
    <>
      <SopsList
        sops={sops}
        isManagement={isManagement}
        uploadersById={uploadersById}
        onRequestUpload={() => setUploadOpen(true)}
        onRequestEdit={(sop) => setPendingEdit(sop)}
        onRequestDelete={() => {
          // Wired in Task 16.
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
    </>
  );
}
