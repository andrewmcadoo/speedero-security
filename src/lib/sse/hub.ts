export type Subscriber = {
  id: string;
  send: (event: string, data: string) => void;
  close: () => void;
};

export const DEBOUNCE_MS = 400;

const subscribers = new Set<Subscriber>();
let lastFireAt = 0;
let trailingTimer: ReturnType<typeof setTimeout> | null = null;

export function subscribe(s: Subscriber): () => void {
  subscribers.add(s);
  return () => {
    subscribers.delete(s);
  };
}

function fire(): void {
  for (const s of subscribers) {
    s.send("changed", "");
  }
  lastFireAt = Date.now();
}

export function broadcastChanged(): void {
  const now = Date.now();
  const elapsed = now - lastFireAt;

  if (elapsed >= DEBOUNCE_MS) {
    // Leading edge: fire immediately, open the window.
    fire();
    return;
  }

  // Inside the window: schedule (or reschedule) one trailing fire.
  if (trailingTimer) return;
  trailingTimer = setTimeout(() => {
    trailingTimer = null;
    fire();
  }, DEBOUNCE_MS - elapsed);
}

export function _statsForTest(): { count: number } {
  return { count: subscribers.size };
}

export function _resetForTest(): void {
  subscribers.clear();
  lastFireAt = 0;
  if (trailingTimer) {
    clearTimeout(trailingTimer);
    trailingTimer = null;
  }
}
