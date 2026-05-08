import { createClient } from "@/lib/supabase/server";
import { subscribe } from "@/lib/sse/hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;

export async function GET(): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();
  let unsub: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const safeEnqueue = (chunk: Uint8Array) => {
        try {
          controller.enqueue(chunk);
        } catch {
          // Stream closed (client disconnected) — ignore.
        }
      };

      unsub = subscribe({
        id: crypto.randomUUID(),
        send: (event, data) =>
          safeEnqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`)),
        close: () => {
          try {
            controller.close();
          } catch {
            // Already closed — ignore.
          }
        },
      });

      // Initial comment opens the stream for browsers that buffer headers.
      safeEnqueue(encoder.encode(`: open\n\n`));

      heartbeat = setInterval(() => {
        safeEnqueue(encoder.encode(`: ping\n\n`));
      }, HEARTBEAT_MS);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      if (unsub) unsub();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Apache needs this disabled at the proxy level too — see deploy doc.
      "X-Accel-Buffering": "no",
    },
  });
}
