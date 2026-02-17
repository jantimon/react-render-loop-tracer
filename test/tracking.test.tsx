import { useState, useReducer, useEffect } from "react";
import { render, act, screen } from "@testing-library/react";

describe("React Render Loop Tracer", () => {
  let logs: string[];

  beforeEach(() => {
    logs = [];
    globalThis.__effectTrackerLogger = (msg: string) => logs.push(msg);
  });

  afterEach(() => {
    delete globalThis.__effectTrackerLogger;
    globalThis.__effectTracker = null;
  });

  it("logs when useEffect sets state on initial mount", async () => {
    function Counter() {
      const [count, setCount] = useState(0);

      useEffect(() => {
        setCount(1);
      }, []);

      return <div data-testid="count">{count}</div>;
    }

    await act(async () => {
      render(<Counter />);
    });

    expect(logs.length).toBe(1);
    expect(logs[0]).toContain("useEffect");
    expect(logs[0]).toContain("Counter");
    expect(logs[0]).toContain('"count"');
    expect(logs[0]).toContain("initially mounted");
  });

  it("logs when useEffect sets state because a dependency changed", async () => {
    function DepTracker() {
      const [x, setX] = useState(0);
      const [derived, setDerived] = useState(0);

      useEffect(() => {
        setDerived(x * 2);
      }, [x]);

      return (
        <div>
          <span data-testid="derived">{derived}</span>
          <button data-testid="inc" onClick={() => setX((v) => v + 1)}>
            inc
          </button>
        </div>
      );
    }

    await act(async () => {
      render(<DepTracker />);
    });

    expect(logs.length).toBe(1);
    expect(logs[0]).toContain("initially mounted");

    logs.length = 0;

    await act(async () => {
      screen.getByTestId("inc").click();
    });

    expect(logs.length).toBe(1);
    expect(logs[0]).toContain("DepTracker");
    expect(logs[0]).toContain('"derived"');
    expect(logs[0]).toContain("x changed");
  });

  it("tracks multiple state updates from a single effect", async () => {
    function MultiState() {
      const [a, setA] = useState("");
      const [b, setB] = useState("");

      useEffect(() => {
        setA("hello");
        setB("world");
      }, []);

      return (
        <div>
          {a} {b}
        </div>
      );
    }

    await act(async () => {
      render(<MultiState />);
    });

    expect(logs.length).toBe(2);
    expect(logs[0]).toContain('"a"');
    expect(logs[1]).toContain('"b"');
  });

  it("includes file location in log messages", async () => {
    function Located() {
      const [val, setVal] = useState(0);

      useEffect(() => {
        setVal(42);
      }, []);

      return <div>{val}</div>;
    }

    await act(async () => {
      render(<Located />);
    });

    expect(logs.length).toBe(1);
    expect(logs[0]).toMatch(/tracking\.test\.tsx:\d+/);
  });

  it("does not log when setState is called outside of an effect", async () => {
    function ClickOnly() {
      const [count, setCount] = useState(0);

      return (
        <button data-testid="click-btn" onClick={() => setCount((prev) => prev + 1)}>
          {count}
        </button>
      );
    }

    await act(async () => {
      render(<ClickOnly />);
    });

    expect(logs.length).toBe(0);

    await act(async () => {
      screen.getByTestId("click-btn").click();
    });

    expect(logs.length).toBe(0);
  });

  it("tracks which specific dependencies changed", async () => {
    function MultiDep() {
      const [a, setA] = useState(0);
      const [b, setB] = useState(0);
      const [result, setResult] = useState(0);

      useEffect(() => {
        setResult(a + b);
      }, [a, b]);

      return (
        <div>
          <span data-testid="result">{result}</span>
          <button data-testid="inc-a" onClick={() => setA((v) => v + 1)}>
            a
          </button>
          <button data-testid="inc-b" onClick={() => setB((v) => v + 1)}>
            b
          </button>
        </div>
      );
    }

    await act(async () => {
      render(<MultiDep />);
    });

    expect(logs.length).toBe(1);
    expect(logs[0]).toContain("initially mounted");

    logs.length = 0;

    await act(async () => {
      screen.getByTestId("inc-a").click();
    });

    expect(logs.length).toBe(1);
    expect(logs[0]).toContain("a changed");
    expect(logs[0]).not.toContain("b changed");
  });

  it("logs when useEffect dispatches to useReducer on initial mount", async () => {
    function reducer(state: number, action: { type: "increment" }) {
      return action.type === "increment" ? state + 1 : state;
    }

    function ReducerComp() {
      const [count, dispatch] = useReducer(reducer, 0);

      useEffect(() => {
        dispatch({ type: "increment" });
      }, []);

      return <div data-testid="count">{count}</div>;
    }

    await act(async () => {
      render(<ReducerComp />);
    });

    expect(logs.length).toBe(1);
    expect(logs[0]).toContain("useEffect");
    expect(logs[0]).toContain("ReducerComp");
    expect(logs[0]).toContain('useReducer "count"');
    expect(logs[0]).toContain("initially mounted");
  });

  it("logs when useEffect dispatches to useReducer because a dependency changed", async () => {
    function reducer(state: number, action: { type: "set"; value: number }) {
      return action.type === "set" ? action.value : state;
    }

    function ReducerDep() {
      const [x, setX] = useState(0);
      const [derived, dispatch] = useReducer(reducer, 0);

      useEffect(() => {
        dispatch({ type: "set", value: x * 2 });
      }, [x]);

      return (
        <div>
          <span data-testid="derived">{derived}</span>
          <button data-testid="inc" onClick={() => setX((v) => v + 1)}>
            inc
          </button>
        </div>
      );
    }

    await act(async () => {
      render(<ReducerDep />);
    });

    expect(logs.length).toBe(1);
    expect(logs[0]).toContain("initially mounted");

    logs.length = 0;

    await act(async () => {
      screen.getByTestId("inc").click();
    });

    expect(logs.length).toBe(1);
    expect(logs[0]).toContain("ReducerDep");
    expect(logs[0]).toContain('useReducer "derived"');
    expect(logs[0]).toContain("x changed");
  });

  it("does not log when dispatch is called outside of an effect", async () => {
    function reducer(state: number, action: "inc") {
      return action === "inc" ? state + 1 : state;
    }

    function ReducerClick() {
      const [count, dispatch] = useReducer(reducer, 0);

      return (
        <button data-testid="dispatch-btn" onClick={() => dispatch("inc")}>
          {count}
        </button>
      );
    }

    await act(async () => {
      render(<ReducerClick />);
    });

    expect(logs.length).toBe(0);

    await act(async () => {
      screen.getByTestId("dispatch-btn").click();
    });

    expect(logs.length).toBe(0);
  });

  it("tracks useReducer with init function", async () => {
    function reducer(state: number, action: "inc") {
      return action === "inc" ? state + 1 : state;
    }

    function init(initial: number) {
      return initial * 10;
    }

    function ReducerInit() {
      const [count, dispatch] = useReducer(reducer, 5, init);

      useEffect(() => {
        dispatch("inc");
      }, []);

      return <div data-testid="count">{count}</div>;
    }

    await act(async () => {
      render(<ReducerInit />);
    });

    expect(logs.length).toBe(1);
    expect(logs[0]).toContain('useReducer "count"');
    expect(logs[0]).toContain("initially mounted");
    expect(screen.getByTestId("count").textContent).toBe("51");
  });
});
