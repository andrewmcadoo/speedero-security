export type Subscriber = {
  id: string;
  send: (event: string, data: string) => void;
  close: () => void;
};

const subscribers = new Set<Subscriber>();

export function subscribe(s: Subscriber): () => void {
  subscribers.add(s);
  return () => {
    subscribers.delete(s);
  };
}

export function broadcastChanged(): void {
  for (const s of subscribers) {
    s.send("changed", "");
  }
}

export function _statsForTest(): { count: number } {
  return { count: subscribers.size };
}

export function _resetForTest(): void {
  subscribers.clear();
}
