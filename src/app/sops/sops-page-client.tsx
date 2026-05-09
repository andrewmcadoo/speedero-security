// src/app/sops/sops-page-client.tsx
"use client";

import { useState } from "react";
import { SopsList } from "@/components/sops-list";
import type { Sop } from "@/types/sops";

interface Props {
  sops: Sop[];
  isManagement: boolean;
  uploadersById: Record<string, string>;
}

export function SopsPageClient({ sops, isManagement, uploadersById }: Props) {
  // Modal/edit/delete state — wired up by later tasks.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_pendingEdit, setPendingEdit] = useState<Sop | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_pendingDelete, setPendingDelete] = useState<Sop | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_uploadOpen, setUploadOpen] = useState(false);

  return (
    <>
      <SopsList
        sops={sops}
        isManagement={isManagement}
        uploadersById={uploadersById}
        onRequestUpload={() => setUploadOpen(true)}
        onRequestEdit={(sop) => setPendingEdit(sop)}
        onRequestDelete={(sop) => setPendingDelete(sop)}
      />
      {/* Upload/edit modal added in Task 14, delete confirm added in Task 16. */}
    </>
  );
}
