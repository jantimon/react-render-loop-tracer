import { useState, useEffect } from "react";
import { render, act } from "@testing-library/react";
import { vi } from "vitest";

describe("INP Grouping", () => {
  let observerCallbacks: Map<string, PerformanceObserverCallback>;

  beforeEach(() => {
    observerCallbacks = new Map();
    vi.stubGlobal(
      "PerformanceObserver",
      class MockPerformanceObserver {
        private _cb: PerformanceObserverCallback;
        constructor(cb: PerformanceObserverCallback) {
          this._cb = cb;
        }
        observe(opts: { type: string; buffered?: boolean; durationThreshold?: number }) {
          observerCallbacks.set(opts.type, this._cb);
        }
        disconnect() {}
      },
    );

    delete globalThis.__effectTrackerLogger;
    globalThis.__effectTracker = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    globalThis.__effectTracker = null;
  });

  it("groups buffered logs under a Slow Interaction console.group", async () => {
    const groupSpy = vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const groupEndSpy = vi.spyOn(console, "groupEnd").mockImplementation(() => {});

    vi.resetModules();
    const runtime = await import("@jantimon/react-render-loop-tracer/runtime");

    const beforeRender = performance.now();

    function App() {
      const [a, setA] = runtime.__trackedUseState(0, "App.tsx:3", "App", "a");
      const [b, setB] = runtime.__trackedUseState(0, "App.tsx:4", "App", "b");

      runtime.__trackedUseEffect(
        () => {
          setA(1);
          setB(2);
        },
        [],
        "App.tsx:6",
        "App",
        [],
      );

      return null;
    }

    await act(async () => {
      render(<App />);
    });

    const afterRender = performance.now();

    const mockEventList = {
      getEntries: () => [
        {
          entryType: "event",
          name: "click",
          startTime: beforeRender - 50,
          duration: 320,
          processingStart: beforeRender - 1,
          processingEnd: afterRender + 1,
          interactionId: 42,
          toJSON: () => ({}),
        },
      ],
    };
    observerCallbacks.get("event")!(
      mockEventList as unknown as PerformanceObserverEntryList,
      {} as PerformanceObserver,
    );

    expect(groupSpy).toHaveBeenCalledTimes(1);
    expect(groupSpy.mock.calls[0][0]).toMatch(/Slow Interaction: click \(320ms\)/);
    expect(groupSpy.mock.calls[0][0]).toContain("2 effect\u2192setState");

    // Both state-change entries from same effect (App.tsx:6:App) → shows count 1/2, 2/2
    const logCalls = logSpy.mock.calls.map(([message]) => message as string);
    expect(logCalls.some((message) => message.includes('"a"'))).toBe(true);
    expect(logCalls.some((message) => message.includes('"b"'))).toBe(true);
    expect(logCalls.some((message) => message.includes("1/2"))).toBe(true);
    expect(logCalls.some((message) => message.includes("2/2"))).toBe(true);

    expect(groupEndSpy).toHaveBeenCalledTimes(1);
  });

  it("coalesces multiple events with same interactionId using worst duration", async () => {
    const groupSpy = vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "groupEnd").mockImplementation(() => {});

    vi.resetModules();
    const runtime = await import("@jantimon/react-render-loop-tracer/runtime");

    const beforeRender = performance.now();

    function App() {
      const [a, setA] = runtime.__trackedUseState(0, "App.tsx:3", "App", "a");

      runtime.__trackedUseEffect(
        () => {
          setA(1);
        },
        [],
        "App.tsx:5",
        "App",
        [],
      );

      return null;
    }

    await act(async () => {
      render(<App />);
    });

    const afterRender = performance.now();

    // Two events for the same interaction — pointerdown (shorter) and click (longer)
    const mockEventList = {
      getEntries: () => [
        {
          entryType: "event",
          name: "pointerdown",
          startTime: beforeRender - 60,
          duration: 250,
          processingStart: beforeRender - 1,
          processingEnd: afterRender + 1,
          interactionId: 7,
          toJSON: () => ({}),
        },
        {
          entryType: "event",
          name: "click",
          startTime: beforeRender - 50,
          duration: 320,
          processingStart: beforeRender - 1,
          processingEnd: afterRender + 1,
          interactionId: 7,
          toJSON: () => ({}),
        },
      ],
    };
    observerCallbacks.get("event")!(
      mockEventList as unknown as PerformanceObserverEntryList,
      {} as PerformanceObserver,
    );

    // Should use the click (320ms) since it has the worst duration
    expect(groupSpy).toHaveBeenCalledTimes(1);
    expect(groupSpy.mock.calls[0][0]).toMatch(/Slow Interaction: click \(320ms\)/);
  });

  it("skips events with interactionId 0", async () => {
    const groupSpy = vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
    vi.spyOn(console, "groupEnd").mockImplementation(() => {});

    vi.resetModules();
    const runtime = await import("@jantimon/react-render-loop-tracer/runtime");

    const beforeRender = performance.now();

    function App() {
      const [a, setA] = runtime.__trackedUseState(0, "App.tsx:3", "App", "a");

      runtime.__trackedUseEffect(
        () => {
          setA(1);
        },
        [],
        "App.tsx:5",
        "App",
        [],
      );

      return null;
    }

    await act(async () => {
      render(<App />);
    });

    const afterRender = performance.now();

    const mockEventList = {
      getEntries: () => [
        {
          entryType: "event",
          name: "mousemove",
          startTime: beforeRender - 50,
          duration: 320,
          processingStart: beforeRender - 1,
          processingEnd: afterRender + 1,
          interactionId: 0,
          toJSON: () => ({}),
        },
      ],
    };
    observerCallbacks.get("event")!(
      mockEventList as unknown as PerformanceObserverEntryList,
      {} as PerformanceObserver,
    );

    // interactionId 0 should be skipped entirely
    expect(groupSpy).not.toHaveBeenCalled();
  });

  it("shows both setState and non-loop effects in interaction group", async () => {
    const groupSpy = vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "groupEnd").mockImplementation(() => {});

    vi.resetModules();
    const runtime = await import("@jantimon/react-render-loop-tracer/runtime");

    const beforeRender = performance.now();

    function App() {
      const [a, setA] = runtime.__trackedUseState(0, "App.tsx:3", "App", "a");

      runtime.__trackedUseEffect(
        () => {
          setA(1);
        },
        [],
        "App.tsx:6",
        "App",
        [],
      );

      // Effect that does NOT set state
      runtime.__trackedUseEffect(() => {}, [], "App.tsx:12", "App", []);

      return null;
    }

    await act(async () => {
      render(<App />);
    });

    const afterRender = performance.now();

    const mockEventList = {
      getEntries: () => [
        {
          entryType: "event",
          name: "keydown",
          startTime: beforeRender - 50,
          duration: 280,
          processingStart: beforeRender - 1,
          processingEnd: afterRender + 1,
          interactionId: 99,
          toJSON: () => ({}),
        },
      ],
    };
    observerCallbacks.get("event")!(
      mockEventList as unknown as PerformanceObserverEntryList,
      {} as PerformanceObserver,
    );

    expect(groupSpy).toHaveBeenCalledTimes(1);
    const header = groupSpy.mock.calls[0][0] as string;
    expect(header).toContain("1 effect\u2192setState");
    expect(header).toContain("1 other effects");

    // state-change entry logged via console.log
    const logMessages = logSpy.mock.calls.map(([message]) => message as string);
    expect(logMessages.some((message) => message.includes('"a"'))).toBe(true);

    // effect-run entry logged via console.info
    const infoMessages = infoSpy.mock.calls.map(([message]) => message as string);
    expect(infoMessages.some((message) => message.includes("ran because"))).toBe(true);
  });
});
