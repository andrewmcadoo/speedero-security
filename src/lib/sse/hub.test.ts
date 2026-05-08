import { afterEach, describe, expect, test } from "bun:test";
import {
  _resetForTest,
  _statsForTest,
  broadcastChanged,
  subscribe,
} from "./hub";

afterEach(() => {
  _resetForTest();
});

type Received = { event: string; data: string };

function makeRecorder() {
  const received: Received[] = [];
  return {
    subscriber: {
      id: "test",
      send: (event: string, data: string) => {
        received.push({ event, data });
      },
      close: () => {},
    },
    received,
  };
}

describe("hub — subscribe / broadcast", () => {
  test("subscribed receives broadcastChanged event", () => {
    const r = makeRecorder();
    subscribe(r.subscriber);
    broadcastChanged();
    // Allow the leading-edge fire to settle synchronously.
    expect(r.received.length).toBeGreaterThanOrEqual(1);
    expect(r.received[0]?.event).toBe("changed");
  });

  test("multiple subscribers all receive", () => {
    const a = makeRecorder();
    const b = makeRecorder();
    subscribe(a.subscriber);
    subscribe(b.subscriber);
    broadcastChanged();
    expect(a.received.length).toBeGreaterThanOrEqual(1);
    expect(b.received.length).toBeGreaterThanOrEqual(1);
  });

  test("unsubscribed does not receive", () => {
    const r = makeRecorder();
    const unsub = subscribe(r.subscriber);
    unsub();
    broadcastChanged();
    expect(r.received.length).toBe(0);
  });

  test("_statsForTest reports active count", () => {
    expect(_statsForTest().count).toBe(0);
    const a = makeRecorder();
    const unsubA = subscribe(a.subscriber);
    expect(_statsForTest().count).toBe(1);
    const b = makeRecorder();
    subscribe(b.subscriber);
    expect(_statsForTest().count).toBe(2);
    unsubA();
    expect(_statsForTest().count).toBe(1);
  });
});

describe("hub — debounce", () => {
  test("leading edge fires immediately on first call", () => {
    const r = makeRecorder();
    subscribe(r.subscriber);
    broadcastChanged();
    expect(r.received.length).toBe(1);
  });

  test("burst of 30 within window produces exactly 2 broadcasts (leading + trailing)", async () => {
    const r = makeRecorder();
    subscribe(r.subscriber);
    for (let i = 0; i < 30; i++) {
      broadcastChanged();
    }
    expect(r.received.length).toBe(1); // only leading edge has fired so far
    await new Promise((res) => setTimeout(res, 500)); // > DEBOUNCE_MS (400)
    expect(r.received.length).toBe(2);
  });

  test("single call after window → only one broadcast (no spurious trailing)", async () => {
    const r = makeRecorder();
    subscribe(r.subscriber);
    broadcastChanged();
    await new Promise((res) => setTimeout(res, 500));
    expect(r.received.length).toBe(1);
  });

  test("two calls separated by > DEBOUNCE_MS produce 2 broadcasts (no debounce)", async () => {
    const r = makeRecorder();
    subscribe(r.subscriber);
    broadcastChanged();
    await new Promise((res) => setTimeout(res, 500));
    broadcastChanged();
    expect(r.received.length).toBe(2);
  });
});
