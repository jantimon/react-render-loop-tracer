import { useState, useEffect } from "react";
import { render, act } from "@testing-library/react";
import { vi } from "vitest";

describe("Long Task Grouping", () => {
  let observerCallbacks: Map<string, PerformanceObserverCallback>;

  beforeEach(() => {
    observerCallbacks = new Map();
    // Mock PerformanceObserver so we can trigger long task entries manually
    vi.stubGlobal(
      "PerformanceObserver",
      class MockPerformanceObserver {
        private _cb: PerformanceObserverCallback;
        constructor(cb: PerformanceObserverCallback) {
          this._cb = cb;
        }
        observe(opts: { type: string; buffered?: boolean }) {
          observerCallbacks.set(opts.type, this._cb);
        }
        disconnect() {}
      },
    );

    // Delete custom logger so logs go through the buffer → console path
    delete globalThis.__effectTrackerLogger;
    globalThis.__effectTracker = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    globalThis.__effectTracker = null;
  });

  it("groups buffered logs under a Long Task console.group", async () => {
    const groupSpy = vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const groupEndSpy = vi.spyOn(console, "groupEnd").mockImplementation(() => {});

    // Re-import runtime to pick up our mocked PerformanceObserver
    // We need to trigger the module's initLongTaskObserver()
    vi.resetModules();
    const runtime = await import("@jantimon/react-render-loop-tracer/runtime");

    // Record timestamps around rendering
    const beforeRender = performance.now();

    function App() {
      const [a, setA] = runtime.__trackedUseState(0, "App.tsx:3", "App", "a");
      const [b, setB] = runtime.__trackedUseState(0, "App.tsx:4", "App", "b");

      // Manually call the tracked effect impl
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

    // Simulate a long task that covers the render window
    const mockTaskList = {
      getEntries: () => [
        {
          entryType: "longtask",
          startTime: beforeRender - 1,
          duration: afterRender - beforeRender + 10,
          name: "self",
          toJSON: () => ({}),
        },
      ],
    };
    observerCallbacks.get("longtask")!(
      mockTaskList as unknown as PerformanceObserverEntryList,
      {} as PerformanceObserver,
    );

    // Should have used console.group for the long task
    expect(groupSpy).toHaveBeenCalledTimes(1);
    expect(groupSpy.mock.calls[0][0]).toMatch(/Long Task \(\d+ms\)/);
    expect(groupSpy.mock.calls[0][0]).toContain("2 effect\u2192setState");

    // Both state-change entries from same effect (App.tsx:6:App) → shows count 1/2, 2/2
    const logCalls = logSpy.mock.calls.map(([message]) => message as string);
    expect(logCalls.some((message) => message.includes('"a"'))).toBe(true);
    expect(logCalls.some((message) => message.includes('"b"'))).toBe(true);
    // Both entries share the same countKey so count should be shown
    expect(logCalls.some((message) => message.includes("1/2"))).toBe(true);
    expect(logCalls.some((message) => message.includes("2/2"))).toBe(true);

    // Group was closed
    expect(groupEndSpy).toHaveBeenCalledTimes(1);
  });

  it("flushes buffered logs individually when no long task covers them", async () => {
    vi.useFakeTimers();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const groupSpy = vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});

    vi.resetModules();
    const runtime = await import("@jantimon/react-render-loop-tracer/runtime");

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

    // No long task observed — advance timers to trigger flush
    await vi.advanceTimersByTimeAsync(200);

    // Should have flushed as individual log (no grouping)
    expect(groupSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain('"a"');
    expect(logSpy.mock.calls[0][0]).toContain("initially mounted");
    expect(logSpy.mock.calls[0][0]).toContain("[state-change]");

    vi.useRealTimers();
  });

  it("shows both setState and non-loop effects in long task group", async () => {
    const groupSpy = vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const groupEndSpy = vi.spyOn(console, "groupEnd").mockImplementation(() => {});

    vi.resetModules();
    const runtime = await import("@jantimon/react-render-loop-tracer/runtime");

    const beforeRender = performance.now();

    function App() {
      const [a, setA] = runtime.__trackedUseState(0, "App.tsx:3", "App", "a");

      // Effect that sets state (state-change)
      runtime.__trackedUseEffect(
        () => {
          setA(1);
        },
        [],
        "App.tsx:6",
        "App",
        [],
      );

      // Effect that does NOT set state (effect-run)
      runtime.__trackedUseEffect(
        () => {
          // just work, no setState
        },
        [],
        "App.tsx:12",
        "App",
        [],
      );

      return null;
    }

    await act(async () => {
      render(<App />);
    });

    const afterRender = performance.now();

    const mockTaskList = {
      getEntries: () => [
        {
          entryType: "longtask",
          startTime: beforeRender - 1,
          duration: afterRender - beforeRender + 10,
          name: "self",
          toJSON: () => ({}),
        },
      ],
    };
    observerCallbacks.get("longtask")!(
      mockTaskList as unknown as PerformanceObserverEntryList,
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

    expect(groupEndSpy).toHaveBeenCalledTimes(1);
  });

  it("does not flush effect-run entries individually", async () => {
    vi.useFakeTimers();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const groupSpy = vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});

    vi.resetModules();
    const runtime = await import("@jantimon/react-render-loop-tracer/runtime");

    function App() {
      // Effect without setState — produces only an effect-run entry
      runtime.__trackedUseEffect(() => {}, [], "App.tsx:3", "App", []);

      return null;
    }

    await act(async () => {
      render(<App />);
    });

    // Advance timers to trigger flush
    await vi.advanceTimersByTimeAsync(200);

    // effect-run entries should be skipped in flushBuffer
    expect(groupSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
