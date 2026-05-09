// src/app/sops/actions.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { _uploadSopForTest, _updateSopForTest, _deleteSopForTest } from "./actions";

function makeFormData(file: File, fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append("file", file);
  return fd;
}

function pdfFile(name = "ops.pdf", size = 1024) {
  return new File([new Uint8Array(size)], name, { type: "application/pdf" });
}

function makeStubSupabase(opts: {
  user?: { id: string } | null;
  rpcResult?: { error: { message: string } | null };
  uploadResult?: { error: { message: string } | null };
  removeResult?: { error: { message: string } | null };
} = {}) {
  const calls = {
    rpc: [] as { name: string; args: Record<string, unknown> }[],
    uploadPaths: [] as string[],
    removedPaths: [] as string[],
  };
  return {
    calls,
    client: {
      auth: {
        getUser: async () => ({
          data: { user: opts.user !== undefined ? opts.user : { id: "mgr-1" } },
        }),
      },
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.rpc.push({ name, args });
        return opts.rpcResult ?? { error: null };
      },
      storage: {
        from: () => ({
          upload: async (path: string) => {
            calls.uploadPaths.push(path);
            return opts.uploadResult ?? { error: null };
          },
          remove: async (paths: string[]) => {
            calls.removedPaths.push(...paths);
            return opts.removeResult ?? { error: null };
          },
        }),
      },
    },
  };
}

describe("_uploadSopForTest", () => {
  test("rejects unauthenticated callers", async () => {
    const stub = makeStubSupabase({ user: null });
    const result = await _uploadSopForTest(
      makeFormData(pdfFile(), { title: "T", audience: "shared" }),
      () => stub.client,
      new Date("2026-05-08T14:32:11Z")
    );
    expect(result.ok).toBe(false);
    expect(stub.calls.uploadPaths).toEqual([]);
    expect(stub.calls.rpc).toEqual([]);
  });

  test("blank title falls back to file basename", async () => {
    const stub = makeStubSupabase();
    const result = await _uploadSopForTest(
      makeFormData(pdfFile("Boarding Procedure.pdf"), { title: "  ", audience: "shared" }),
      () => stub.client,
      new Date("2026-05-08T14:32:11Z")
    );
    expect(result.ok).toBe(true);
    expect(stub.calls.rpc).toHaveLength(1);
    expect(stub.calls.rpc[0].args.p_title).toBe("Boarding-Procedure");
  });

  test("rejects unsupported file types", async () => {
    const stub = makeStubSupabase();
    const txt = new File(["x"], "notes.txt", { type: "text/plain" });
    const result = await _uploadSopForTest(
      makeFormData(txt, { title: "T", audience: "shared" }),
      () => stub.client,
      new Date("2026-05-08T14:32:11Z")
    );
    expect(result.ok).toBe(false);
    expect(stub.calls.uploadPaths).toEqual([]);
  });

  test("rejects oversize files", async () => {
    const stub = makeStubSupabase();
    const big = pdfFile("big.pdf", 26 * 1024 * 1024);
    const result = await _uploadSopForTest(
      makeFormData(big, { title: "T", audience: "shared" }),
      () => stub.client,
      new Date("2026-05-08T14:32:11Z")
    );
    expect(result.ok).toBe(false);
    expect(stub.calls.uploadPaths).toEqual([]);
  });

  test("PDF upload: stores one file and calls record_sop_upload RPC", async () => {
    const stub = makeStubSupabase();
    const result = await _uploadSopForTest(
      makeFormData(pdfFile(), { title: "Boarding", audience: "shared" }),
      () => stub.client,
      new Date("2026-05-08T14:32:11Z")
    );
    expect(result.ok).toBe(true);
    expect(stub.calls.uploadPaths).toHaveLength(1);
    expect(stub.calls.uploadPaths[0]).toMatch(
      /^[0-9a-f-]+\/20260508T143211Z\/ops-v1\.pdf$/
    );
    expect(stub.calls.rpc).toHaveLength(1);
    expect(stub.calls.rpc[0].name).toBe("record_sop_upload");
    const args = stub.calls.rpc[0].args;
    expect(args.p_title).toBe("Boarding");
    expect(args.p_audience).toBe("shared");
    expect(args.p_actor_id).toBe("mgr-1");
    expect(args.p_storage_path_pdf).toBe(args.p_storage_path_original);
  });

  test("rolls back the storage upload when the RPC fails", async () => {
    const stub = makeStubSupabase({
      rpcResult: { error: { message: "rpc exploded" } },
    });
    const result = await _uploadSopForTest(
      makeFormData(pdfFile(), { title: "Boarding", audience: "shared" }),
      () => stub.client,
      new Date("2026-05-08T14:32:11Z")
    );
    expect(result.ok).toBe(false);
    expect(stub.calls.uploadPaths).toHaveLength(1);
    expect(stub.calls.removedPaths).toEqual(stub.calls.uploadPaths);
  });
});

function makeUpdateStub(opts: {
  user?: { id: string } | null;
  currentSop?: {
    id: string;
    title?: string;
    storage_path_pdf: string;
    storage_path_original: string;
    original_filename: string;
    original_mime_type: string;
  } | null;
  rpcResult?: { error: { message: string } | null };
  auditCount?: number;
} = {}) {
  const calls = {
    rpc: [] as { name: string; args: Record<string, unknown> }[],
    uploadPaths: [] as string[],
  };
  return {
    calls,
    client: {
      auth: {
        getUser: async () => ({ data: { user: opts.user !== undefined ? opts.user : { id: "mgr-1" } } }),
      },
      from: (table: string) => {
        if (table === "sop_audit_log") {
          return {
            select: () => ({
              eq: () => ({
                in: async () => ({ count: opts.auditCount ?? 0, error: null }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: opts.currentSop ?? null,
                error: null,
              }),
            }),
          }),
        };
      },
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.rpc.push({ name, args });
        return opts.rpcResult ?? { error: null };
      },
      storage: {
        from: () => ({
          upload: async (path: string) => {
            calls.uploadPaths.push(path);
            return { error: null };
          },
          remove: async () => ({ error: null }),
        }),
      },
    },
  };
}

describe("_updateSopForTest", () => {
  test("metadata-only update calls record_sop_update without uploading", async () => {
    const stub = makeUpdateStub({
      currentSop: {
        id: "sop-1",
        storage_path_pdf: "sop-1/old/document.pdf",
        storage_path_original: "sop-1/old/original.pdf",
        original_filename: "old.pdf",
        original_mime_type: "application/pdf",
      },
    });
    const fd = new FormData();
    fd.append("title", "New Title");
    fd.append("description", "Now described");
    fd.append("audience", "shared");
    // No file

    const result = await _updateSopForTest(
      "sop-1",
      fd,
      () => stub.client,
      new Date("2026-05-08T14:32:11Z")
    );

    expect(result.ok).toBe(true);
    expect(stub.calls.uploadPaths).toEqual([]);
    expect(stub.calls.rpc).toHaveLength(1);
    expect(stub.calls.rpc[0].name).toBe("record_sop_update");
    expect(stub.calls.rpc[0].args.p_new_storage_path_pdf).toBeNull();
  });

  test("file replacement: path uses new file basename and next version", async () => {
    const stub = makeUpdateStub({
      currentSop: {
        id: "sop-1",
        title: "Existing",
        storage_path_pdf: "sop-1/old/old-v1.pdf",
        storage_path_original: "sop-1/old/old-v1.pdf",
        original_filename: "old.pdf",
        original_mime_type: "application/pdf",
      },
      auditCount: 1, // one prior upload → next version is 2
    });
    const fd = new FormData();
    fd.append("title", "New Title");
    fd.append("description", "");
    fd.append("audience", "shared");
    fd.append("file", pdfFile("new.pdf", 512));

    const result = await _updateSopForTest(
      "sop-1",
      fd,
      () => stub.client,
      new Date("2026-05-08T14:32:11Z")
    );

    expect(result.ok).toBe(true);
    expect(stub.calls.uploadPaths).toHaveLength(1);
    expect(stub.calls.uploadPaths[0]).toBe(
      "sop-1/20260508T143211Z/new-v2.pdf"
    );
    expect(stub.calls.rpc[0].args.p_new_storage_path_pdf).toBe(
      stub.calls.uploadPaths[0]
    );
  });

  test("rejects when SOP does not exist", async () => {
    const stub = makeUpdateStub({ currentSop: null });
    const fd = new FormData();
    fd.append("title", "T");
    fd.append("description", "");
    fd.append("audience", "shared");

    const result = await _updateSopForTest(
      "missing",
      fd,
      () => stub.client,
      new Date("2026-05-08T14:32:11Z")
    );
    expect(result.ok).toBe(false);
  });
});

describe("_deleteSopForTest", () => {
  test("calls record_sop_delete RPC without removing storage objects", async () => {
    const calls = {
      rpc: [] as { name: string; args: Record<string, unknown> }[],
      removedPaths: [] as string[],
    };
    const client = {
      auth: {
        getUser: async () => ({ data: { user: { id: "mgr-1" } } }),
      },
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.rpc.push({ name, args });
        return { error: null };
      },
      storage: {
        from: () => ({
          remove: async (paths: string[]) => {
            calls.removedPaths.push(...paths);
            return { error: null };
          },
        }),
      },
    };
    const result = await _deleteSopForTest("sop-1", () => client);
    expect(result.ok).toBe(true);
    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0].name).toBe("record_sop_delete");
    expect(calls.rpc[0].args).toEqual({
      p_sop_id: "sop-1",
      p_actor_id: "mgr-1",
    });
    expect(calls.removedPaths).toEqual([]);
  });

  test("returns the RPC error when the delete fails", async () => {
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: "mgr-1" } } }) },
      rpc: async () => ({ error: { message: "nope" } }),
      storage: { from: () => ({ remove: async () => ({ error: null }) }) },
    };
    const result = await _deleteSopForTest("sop-1", () => client);
    expect(result.ok).toBe(false);
  });
});
