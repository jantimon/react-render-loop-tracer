import { useState, useEffect } from "react";
import { render, act, screen } from "@testing-library/react";
import { __trackedUseState, __trackedUseEffect } from "@jantimon/react-render-loop-tracer/runtime";

describe("Effect Run Logging", () => {
  let logs: string[];

  beforeEach(() => {
    logs = [];
    globalThis.__effectTrackerLogger = (msg: string) => logs.push(msg);
  });

  afterEach(() => {
    delete globalThis.__effectTrackerLogger;
    globalThis.__effectTracker = null;
  });

  it("logs 'ran' for effects without setState", async () => {
    function NoStateEffect() {
      const [val, setVal] = useState(0);

      __trackedUseEffect(
        () => {
          // Does work but no setState
          const _ = 1 + 1;
        },
        [],
        "NoStateEffect.tsx:5",
        "NoStateEffect",
        [],
      );

      return <div>{val}</div>;
    }

    await act(async () => {
      render(<NoStateEffect />);
    });

    const ranLog = logs.find((l) => l.includes("ran because"));
    expect(ranLog).toBeDefined();
    expect(ranLog).toContain("NoStateEffect");
    expect(ranLog).toContain("NoStateEffect.tsx:5");
  });

  it("does NOT log 'ran' for effects that call setState", async () => {
    function StateEffect() {
      const [val, setVal] = __trackedUseState(0, "StateEffect.tsx:3", "StateEffect", "val");

      __trackedUseEffect(
        () => {
          setVal(42);
        },
        [],
        "StateEffect.tsx:5",
        "StateEffect",
        [],
      );

      return <div>{val}</div>;
    }

    await act(async () => {
      render(<StateEffect />);
    });

    const ranLog = logs.find((l) => l.includes("ran because"));
    const stateLog = logs.find((l) => l.includes('changed useState "val"'));
    expect(ranLog).toBeUndefined();
    expect(stateLog).toBeDefined();
  });

  it("includes 'initially mounted' reason on first run", async () => {
    function MountEffect() {
      __trackedUseEffect(() => {}, [], "MountEffect.tsx:3", "MountEffect", []);

      return <div>ok</div>;
    }

    await act(async () => {
      render(<MountEffect />);
    });

    const ranLog = logs.find((l) => l.includes("ran because"));
    expect(ranLog).toBeDefined();
    expect(ranLog).toContain("initially mounted");
  });

  it("includes dep change reason when deps change", async () => {
    function DepEffect() {
      const [x, setX] = useState(0);

      __trackedUseEffect(
        () => {
          // no setState
        },
        [x],
        "DepEffect.tsx:5",
        "DepEffect",
        ["x"],
      );

      return (
        <button data-testid="inc" onClick={() => setX((v) => v + 1)}>
          {x}
        </button>
      );
    }

    await act(async () => {
      render(<DepEffect />);
    });

    // Clear initial mount log
    logs.length = 0;

    await act(async () => {
      screen.getByTestId("inc").click();
    });

    const ranLog = logs.find((l) => l.includes("ran because"));
    expect(ranLog).toBeDefined();
    expect(ranLog).toContain("x changed");
  });
});
