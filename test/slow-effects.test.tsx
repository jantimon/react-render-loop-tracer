import { useState, useEffect } from "react";
import { render, act } from "@testing-library/react";
import { __trackedUseState, __trackedUseEffect } from "@jantimon/react-render-loop-tracer/runtime";

describe("Slow Effect Detection", () => {
  let logs: string[];

  beforeEach(() => {
    logs = [];
    globalThis.__effectTrackerLogger = (msg: string) => logs.push(msg);
  });

  afterEach(() => {
    delete globalThis.__effectTrackerLogger;
    globalThis.__effectTracker = null;
  });

  it("logs slow effect warning for effects taking >=8ms", async () => {
    function SlowComponent() {
      const [val, setVal] = useState(0);

      __trackedUseEffect(
        () => {
          // Busy-wait >8ms
          const start = performance.now();
          while (performance.now() - start < 10) {
            // spin
          }
        },
        [],
        "SlowComponent.tsx:5",
        "SlowComponent",
        [],
      );

      return <div>{val}</div>;
    }

    await act(async () => {
      render(<SlowComponent />);
    });

    const slowLog = logs.find((l) => l.includes("Slow effect:"));
    expect(slowLog).toBeDefined();
    expect(slowLog).toContain("SlowComponent");
    expect(slowLog).toContain("SlowComponent.tsx:5");
    expect(slowLog).toMatch(/took \d+ms/);
  });

  it("does not log warning for fast effects", async () => {
    function FastComponent() {
      const [val, setVal] = useState(0);

      __trackedUseEffect(
        () => {
          // Fast effect — no work
        },
        [],
        "FastComponent.tsx:5",
        "FastComponent",
        [],
      );

      return <div>{val}</div>;
    }

    await act(async () => {
      render(<FastComponent />);
    });

    const slowLog = logs.find((l) => l.includes("Slow effect:"));
    expect(slowLog).toBeUndefined();
  });

  it("logs both slow effect and setState messages together", async () => {
    function SlowSetStateComponent() {
      const [val, setVal] = __trackedUseState(
        0,
        "SlowSetState.tsx:3",
        "SlowSetStateComponent",
        "val",
      );

      __trackedUseEffect(
        () => {
          // Busy-wait >8ms
          const start = performance.now();
          while (performance.now() - start < 10) {
            // spin
          }
          setVal(42);
        },
        [],
        "SlowSetState.tsx:5",
        "SlowSetStateComponent",
        [],
      );

      return <div>{val}</div>;
    }

    await act(async () => {
      render(<SlowSetStateComponent />);
    });

    const slowLog = logs.find((l) => l.includes("Slow effect:"));
    const stateLog = logs.find((l) => l.includes('changed useState "val"'));
    expect(slowLog).toBeDefined();
    expect(stateLog).toBeDefined();
  });
});
