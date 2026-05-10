// src/lib/sops/convert.ts
// Server-side DOCX → PDF conversion using LibreOffice headless. Used by
// the SOP upload action when the manager uploads a DOCX.
//
// Requires `soffice` on PATH on the runtime host (see docs/CLIPPER.md).
// Passes -env:UserInstallation pointing into the per-call temp dir so
// LibreOffice doesn't try to write its user profile under $HOME — that
// path is read-only when the app runs under a hardened systemd unit
// (ProtectHome=read-only).

import { spawn as nodeSpawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export class DocxConversionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "DocxConversionError";
  }
}

export interface ConvertDeps {
  spawn?: typeof nodeSpawn;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export async function convertDocxToPdf(
  input: Buffer,
  deps: ConvertDeps = {}
): Promise<Buffer> {
  const spawn = deps.spawn ?? nodeSpawn;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const workDir = await mkdtemp(join(tmpdir(), "sop-convert-"));
  const inputPath = join(workDir, "input.docx");
  const outputPath = join(workDir, "input.pdf");

  await writeFile(inputPath, input);

  try {
    await runSoffice(spawn, workDir, inputPath, timeoutMs);
    return await readFile(outputPath);
  } catch (err) {
    if (err instanceof DocxConversionError) throw err;
    throw new DocxConversionError("DOCX conversion failed", err);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function runSoffice(
  spawn: typeof nodeSpawn,
  workDir: string,
  inputPath: string,
  timeoutMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const profileUrl = pathToFileURL(join(workDir, "uno-profile")).href;
    const child = spawn(
      "soffice",
      [
        "--headless",
        `-env:UserInstallation=${profileUrl}`,
        "--convert-to",
        "pdf",
        "--outdir",
        workDir,
        inputPath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    let stderrBuf = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new DocxConversionError(`LibreOffice timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new DocxConversionError("Failed to spawn soffice", err));
    });

    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(
          new DocxConversionError(
            `soffice exited with code ${code}${stderrBuf ? `: ${stderrBuf.trim()}` : ""}`
          )
        );
      }
    });
  });
}
