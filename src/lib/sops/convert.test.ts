// src/lib/sops/convert.test.ts
import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { writeFile } from "node:fs/promises";
import { convertDocxToPdf, DocxConversionError } from "./convert";

// Build a fake ChildProcess that exposes the surface convert.ts uses:
// stderr emitter + 'error' event + 'exit' event + .kill().
function fakeChild(opts: {
  exitCode?: number | null;
  errorAfterMs?: number;
  exitAfterMs?: number;
  stderr?: string;
  noEvents?: boolean;
}) {
  const child = new EventEmitter() as EventEmitter & {
    stderr: EventEmitter;
    kill: (sig?: NodeJS.Signals | number) => void;
    killed: boolean;
  };
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
  };

  if (opts.noEvents) return child;

  setTimeout(() => {
    if (opts.stderr) child.stderr.emit("data", Buffer.from(opts.stderr));
    if (opts.errorAfterMs !== undefined) {
      child.emit("error", new Error("spawn failed"));
    } else {
      child.emit("exit", opts.exitCode ?? 0);
    }
  }, opts.exitAfterMs ?? opts.errorAfterMs ?? 0);

  return child;
}

describe("convertDocxToPdf", () => {
  test("returns the PDF bytes that LibreOffice writes to outdir", async () => {
    let capturedOutdir: string | null = null;

    const result = await convertDocxToPdf(Buffer.from("fake docx bytes"), {
      spawn: ((_cmd: string, args: string[]) => {
        // args = [--headless, --convert-to, pdf, --outdir, <dir>, <input>]
        capturedOutdir = args[4];
        const inputPath = args[5];
        const outputPath = inputPath.replace(/\.docx$/, ".pdf");
        const fake = fakeChild({ noEvents: true });
        // Simulate soffice writing the output PDF, then exit.
        setImmediate(async () => {
          await writeFile(outputPath, Buffer.from("PDF bytes"));
          setImmediate(() => fake.emit("exit", 0));
        });
        return fake as unknown as ReturnType<typeof import("node:child_process").spawn>;
      }) as typeof import("node:child_process").spawn,
    });

    expect(result.toString()).toBe("PDF bytes");
    expect(capturedOutdir).not.toBeNull();
  });

  test("rejects with DocxConversionError on non-zero exit", async () => {
    await expect(
      convertDocxToPdf(Buffer.from("bad"), {
        spawn: ((() =>
          fakeChild({
            exitCode: 1,
            stderr: "soffice: source file is corrupt",
          })) as unknown) as typeof import("node:child_process").spawn,
      })
    ).rejects.toBeInstanceOf(DocxConversionError);
  });

  test("rejects with DocxConversionError when spawn errors", async () => {
    await expect(
      convertDocxToPdf(Buffer.from("bad"), {
        spawn: ((() =>
          fakeChild({ errorAfterMs: 0 })) as unknown) as typeof import("node:child_process").spawn,
      })
    ).rejects.toBeInstanceOf(DocxConversionError);
  });

  test("kills the child and rejects on timeout", async () => {
    let killed = false;
    await expect(
      convertDocxToPdf(Buffer.from("hang"), {
        spawn: ((() => {
          const f = fakeChild({ noEvents: true });
          const origKill = f.kill;
          f.kill = (sig) => {
            killed = true;
            origKill(sig);
          };
          return f as unknown as ReturnType<
            typeof import("node:child_process").spawn
          >;
        }) as unknown) as typeof import("node:child_process").spawn,
        timeoutMs: 5,
      })
    ).rejects.toBeInstanceOf(DocxConversionError);
    expect(killed).toBe(true);
  });
});
