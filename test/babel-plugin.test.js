import { transformSync } from "@babel/core";
import { describe, it, expect } from "vitest";
import plugin from "../src/babel-plugin.js";

/**
 * @param {string} code
 * @param {string} [filename]
 */
function transform(code, filename = "Component.tsx") {
  const result = transformSync(code, {
    plugins: [plugin],
    presets: [],
    parserOpts: {
      plugins: ["jsx", "typescript"],
    },
    filename,
    configFile: false,
    babelrc: false,
  });
  return /** @type {string} */ (result?.code);
}

describe("babel-plugin transform", () => {
  it("transforms useState", () => {
    const code = `
      import { useState } from "react";
      function Counter() {
        const [count, setCount] = useState(0);
        return <div>{count}</div>;
      }
    `;
    expect(transform(code)).toMatchInlineSnapshot(`
      "import { __trackedUseState } from "@jantimon/react-render-loop-tracer/runtime";
      import { useState } from "react";
      function Counter() {
        const [count, setCount] = __trackedUseState(0, "Component.tsx:4", "Counter", "count");
        return <div>{count}</div>;
      }"
    `);
  });

  it("transforms useEffect with dependencies", () => {
    const code = `
      import { useState, useEffect } from "react";
      function Tracker() {
        const [x, setX] = useState(0);
        useEffect(() => {
          console.log(x);
        }, [x]);
        return <div>{x}</div>;
      }
    `;
    expect(transform(code)).toMatchInlineSnapshot(`
      "import { __trackedUseState, __trackedUseEffect } from "@jantimon/react-render-loop-tracer/runtime";
      import { useState, useEffect } from "react";
      function Tracker() {
        const [x, setX] = __trackedUseState(0, "Component.tsx:4", "Tracker", "x");
        __trackedUseEffect(() => {
          console.log(x);
        }, [x], "Component.tsx:5", "Tracker", ["x"]);
        return <div>{x}</div>;
      }"
    `);
  });

  it("transforms useLayoutEffect", () => {
    const code = `
      import { useLayoutEffect } from "react";
      function Measure() {
        useLayoutEffect(() => {
          console.log("layout");
        }, []);
        return <div />;
      }
    `;
    expect(transform(code)).toMatchInlineSnapshot(`
      "import { __trackedUseLayoutEffect } from "@jantimon/react-render-loop-tracer/runtime";
      import { useLayoutEffect } from "react";
      function Measure() {
        __trackedUseLayoutEffect(() => {
          console.log("layout");
        }, [], "Component.tsx:4", "Measure", []);
        return <div />;
      }"
    `);
  });

  it("transforms useEffect without dependencies", () => {
    const code = `
      import { useEffect } from "react";
      function Logger() {
        useEffect(() => {
          console.log("every render");
        });
        return <div />;
      }
    `;
    expect(transform(code)).toMatchInlineSnapshot(`
      "import { __trackedUseEffect } from "@jantimon/react-render-loop-tracer/runtime";
      import { useEffect } from "react";
      function Logger() {
        __trackedUseEffect(() => {
          console.log("every render");
        }, undefined, "Component.tsx:4", "Logger", null);
        return <div />;
      }"
    `);
  });

  it("transforms useEffect with empty dependency array", () => {
    const code = `
      import { useEffect } from "react";
      function MountOnly() {
        useEffect(() => {
          console.log("mount");
        }, []);
        return <div />;
      }
    `;
    expect(transform(code)).toMatchInlineSnapshot(`
      "import { __trackedUseEffect } from "@jantimon/react-render-loop-tracer/runtime";
      import { useEffect } from "react";
      function MountOnly() {
        __trackedUseEffect(() => {
          console.log("mount");
        }, [], "Component.tsx:4", "MountOnly", []);
        return <div />;
      }"
    `);
  });

  it("handles member expression dependencies", () => {
    const code = `
      import { useEffect } from "react";
      function Watcher({ props }) {
        useEffect(() => {
          console.log(props.foo);
        }, [props.foo, props.bar.baz]);
        return <div />;
      }
    `;
    expect(transform(code)).toMatchInlineSnapshot(`
      "import { __trackedUseEffect } from "@jantimon/react-render-loop-tracer/runtime";
      import { useEffect } from "react";
      function Watcher({
        props
      }) {
        __trackedUseEffect(() => {
          console.log(props.foo);
        }, [props.foo, props.bar.baz], "Component.tsx:4", "Watcher", ["props.foo", "props.bar.baz"]);
        return <div />;
      }"
    `);
  });

  it("detects arrow function component names", () => {
    const code = `
      import { useState } from "react";
      const ArrowComp = () => {
        const [val, setVal] = useState(0);
        return <div>{val}</div>;
      };
    `;
    expect(transform(code)).toMatchInlineSnapshot(`
      "import { __trackedUseState } from "@jantimon/react-render-loop-tracer/runtime";
      import { useState } from "react";
      const ArrowComp = () => {
        const [val, setVal] = __trackedUseState(0, "Component.tsx:4", "ArrowComp", "val");
        return <div>{val}</div>;
      };"
    `);
  });

  it("detects export default function component names", () => {
    const code = `
      import { useState } from "react";
      export default function MyPage() {
        const [val, setVal] = useState(0);
        return <div>{val}</div>;
      }
    `;
    expect(transform(code)).toMatchInlineSnapshot(`
      "import { __trackedUseState } from "@jantimon/react-render-loop-tracer/runtime";
      import { useState } from "react";
      export default function MyPage() {
        const [val, setVal] = __trackedUseState(0, "Component.tsx:4", "MyPage", "val");
        return <div>{val}</div>;
      }"
    `);
  });

  it("combines imports when multiple hooks are used", () => {
    const code = `
      import { useState, useEffect, useLayoutEffect } from "react";
      function App() {
        const [count, setCount] = useState(0);
        useEffect(() => {
          console.log(count);
        }, [count]);
        useLayoutEffect(() => {
          console.log("layout");
        }, []);
        return <div>{count}</div>;
      }
    `;
    expect(transform(code)).toMatchInlineSnapshot(`
      "import { __trackedUseState, __trackedUseEffect, __trackedUseLayoutEffect } from "@jantimon/react-render-loop-tracer/runtime";
      import { useState, useEffect, useLayoutEffect } from "react";
      function App() {
        const [count, setCount] = __trackedUseState(0, "Component.tsx:4", "App", "count");
        __trackedUseEffect(() => {
          console.log(count);
        }, [count], "Component.tsx:5", "App", ["count"]);
        __trackedUseLayoutEffect(() => {
          console.log("layout");
        }, [], "Component.tsx:8", "App", []);
        return <div>{count}</div>;
      }"
    `);
  });

  it("transforms React.useState and React.useEffect", () => {
    const code = `
      import React from "react";
      function Qualified() {
        const [val, setVal] = React.useState(0);
        React.useEffect(() => {
          console.log(val);
        }, [val]);
        return <div>{val}</div>;
      }
    `;
    expect(transform(code)).toMatchInlineSnapshot(`
      "import { __trackedUseState, __trackedUseEffect } from "@jantimon/react-render-loop-tracer/runtime";
      import React from "react";
      function Qualified() {
        const [val, setVal] = __trackedUseState(0, "Component.tsx:4", "Qualified", "val");
        __trackedUseEffect(() => {
          console.log(val);
        }, [val], "Component.tsx:5", "Qualified", ["val"]);
        return <div>{val}</div>;
      }"
    `);
  });

  it("transforms useReducer", () => {
    const code = `
      import { useReducer } from "react";
      function Counter() {
        const [count, dispatch] = useReducer((s, a) => s + a, 0);
        return <div>{count}</div>;
      }
    `;
    expect(transform(code)).toMatchInlineSnapshot(`
      "import { __trackedUseReducer } from "@jantimon/react-render-loop-tracer/runtime";
      import { useReducer } from "react";
      function Counter() {
        const [count, dispatch] = __trackedUseReducer((s, a) => s + a, 0, undefined, "Component.tsx:4", "Counter", "count");
        return <div>{count}</div>;
      }"
    `);
  });

  it("transforms useReducer with init function", () => {
    const code = `
      import { useReducer } from "react";
      function Counter() {
        const [count, dispatch] = useReducer((s, a) => s + a, 0, (n) => n * 10);
        return <div>{count}</div>;
      }
    `;
    expect(transform(code)).toMatchInlineSnapshot(`
      "import { __trackedUseReducer } from "@jantimon/react-render-loop-tracer/runtime";
      import { useReducer } from "react";
      function Counter() {
        const [count, dispatch] = __trackedUseReducer((s, a) => s + a, 0, n => n * 10, "Component.tsx:4", "Counter", "count");
        return <div>{count}</div>;
      }"
    `);
  });

  it("transforms React.useReducer", () => {
    const code = `
      import React from "react";
      function Counter() {
        const [count, dispatch] = React.useReducer((s, a) => s + a, 0);
        return <div>{count}</div>;
      }
    `;
    expect(transform(code)).toMatchInlineSnapshot(`
      "import { __trackedUseReducer } from "@jantimon/react-render-loop-tracer/runtime";
      import React from "react";
      function Counter() {
        const [count, dispatch] = __trackedUseReducer((s, a) => s + a, 0, undefined, "Component.tsx:4", "Counter", "count");
        return <div>{count}</div>;
      }"
    `);
  });

  it("transforms useState and useEffect inside a custom hook", () => {
    const code = `
      import { useState, useEffect } from "react";
      function useCounter() {
        const [count, setCount] = useState(0);
        useEffect(() => {
          document.title = count;
        }, [count]);
        return [count, setCount];
      }
    `;
    expect(transform(code)).toMatchInlineSnapshot(`
      "import { __trackedUseState, __trackedUseEffect } from "@jantimon/react-render-loop-tracer/runtime";
      import { useState, useEffect } from "react";
      function useCounter() {
        const [count, setCount] = __trackedUseState(0, "Component.tsx:4", "useCounter", "count");
        __trackedUseEffect(() => {
          document.title = count;
        }, [count], "Component.tsx:5", "useCounter", ["count"]);
        return [count, setCount];
      }"
    `);
  });

  it("transforms multiple useState calls with useEffect in a custom hook", () => {
    const code = `
      import { useState, useEffect } from "react";
      function useForm() {
        const [name, setName] = useState("");
        const [email, setEmail] = useState("");
        const [isValid, setIsValid] = useState(false);
        useEffect(() => {
          setIsValid(name.length > 0 && email.includes("@"));
        }, [name, email]);
        return { name, setName, email, setEmail, isValid };
      }
    `;
    expect(transform(code)).toMatchInlineSnapshot(`
      "import { __trackedUseState, __trackedUseEffect } from "@jantimon/react-render-loop-tracer/runtime";
      import { useState, useEffect } from "react";
      function useForm() {
        const [name, setName] = __trackedUseState("", "Component.tsx:4", "useForm", "name");
        const [email, setEmail] = __trackedUseState("", "Component.tsx:5", "useForm", "email");
        const [isValid, setIsValid] = __trackedUseState(false, "Component.tsx:6", "useForm", "isValid");
        __trackedUseEffect(() => {
          setIsValid(name.length > 0 && email.includes("@"));
        }, [name, email], "Component.tsx:7", "useForm", ["name", "email"]);
        return {
          name,
          setName,
          email,
          setEmail,
          isValid
        };
      }"
    `);
  });

  it("transforms arrow function custom hook with useState and useEffect", () => {
    const code = `
      import { useState, useEffect } from "react";
      const useDebounce = (value, delay) => {
        const [debounced, setDebounced] = useState(value);
        useEffect(() => {
          const timer = setTimeout(() => setDebounced(value), delay);
          return () => clearTimeout(timer);
        }, [value, delay]);
        return debounced;
      };
    `;
    expect(transform(code)).toMatchInlineSnapshot(`
      "import { __trackedUseState, __trackedUseEffect } from "@jantimon/react-render-loop-tracer/runtime";
      import { useState, useEffect } from "react";
      const useDebounce = (value, delay) => {
        const [debounced, setDebounced] = __trackedUseState(value, "Component.tsx:4", "useDebounce", "debounced");
        __trackedUseEffect(() => {
          const timer = setTimeout(() => setDebounced(value), delay);
          return () => clearTimeout(timer);
        }, [value, delay], "Component.tsx:5", "useDebounce", ["value", "delay"]);
        return debounced;
      };"
    `);
  });

  it("transforms custom hook with useState and useLayoutEffect", () => {
    const code = `
      import { useState, useLayoutEffect } from "react";
      function useWindowSize() {
        const [size, setSize] = useState({ width: 0, height: 0 });
        useLayoutEffect(() => {
          const update = () => setSize({ width: window.innerWidth, height: window.innerHeight });
          window.addEventListener("resize", update);
          return () => window.removeEventListener("resize", update);
        }, []);
        return size;
      }
    `;
    expect(transform(code)).toMatchInlineSnapshot(`
      "import { __trackedUseState, __trackedUseLayoutEffect } from "@jantimon/react-render-loop-tracer/runtime";
      import { useState, useLayoutEffect } from "react";
      function useWindowSize() {
        const [size, setSize] = __trackedUseState({
          width: 0,
          height: 0
        }, "Component.tsx:4", "useWindowSize", "size");
        __trackedUseLayoutEffect(() => {
          const update = () => setSize({
            width: window.innerWidth,
            height: window.innerHeight
          });
          window.addEventListener("resize", update);
          return () => window.removeEventListener("resize", update);
        }, [], "Component.tsx:5", "useWindowSize", []);
        return size;
      }"
    `);
  });

  it("transforms custom hook with useReducer and useEffect", () => {
    const code = `
      import { useReducer, useEffect } from "react";
      function useFetch(url) {
        const [state, dispatch] = useReducer(reducer, { loading: true, data: null });
        useEffect(() => {
          fetch(url).then(r => r.json()).then(data => dispatch({ type: "done", data }));
        }, [url]);
        return state;
      }
    `;
    expect(transform(code)).toMatchInlineSnapshot(`
      "import { __trackedUseReducer, __trackedUseEffect } from "@jantimon/react-render-loop-tracer/runtime";
      import { useReducer, useEffect } from "react";
      function useFetch(url) {
        const [state, dispatch] = __trackedUseReducer(reducer, {
          loading: true,
          data: null
        }, undefined, "Component.tsx:4", "useFetch", "state");
        __trackedUseEffect(() => {
          fetch(url).then(r => r.json()).then(data => dispatch({
            type: "done",
            data
          }));
        }, [url], "Component.tsx:5", "useFetch", ["url"]);
        return state;
      }"
    `);
  });

  it("transforms custom hook with useEffect without deps (re-runs every render)", () => {
    const code = `
      import { useState, useEffect } from "react";
      function useLogger(value) {
        const [count, setCount] = useState(0);
        useEffect(() => {
          console.log("render", value);
          setCount(c => c + 1);
        });
        return count;
      }
    `;
    expect(transform(code)).toMatchInlineSnapshot(`
      "import { __trackedUseState, __trackedUseEffect } from "@jantimon/react-render-loop-tracer/runtime";
      import { useState, useEffect } from "react";
      function useLogger(value) {
        const [count, setCount] = __trackedUseState(0, "Component.tsx:4", "useLogger", "count");
        __trackedUseEffect(() => {
          console.log("render", value);
          setCount(c => c + 1);
        }, undefined, "Component.tsx:5", "useLogger", null);
        return count;
      }"
    `);
  });

  it("transforms custom hook using React.useState and React.useEffect", () => {
    const code = `
      import React from "react";
      function useToggle(initial) {
        const [on, setOn] = React.useState(initial);
        React.useEffect(() => {
          console.log("toggled", on);
        }, [on]);
        return [on, () => setOn(v => !v)];
      }
    `;
    expect(transform(code)).toMatchInlineSnapshot(`
      "import { __trackedUseState, __trackedUseEffect } from "@jantimon/react-render-loop-tracer/runtime";
      import React from "react";
      function useToggle(initial) {
        const [on, setOn] = __trackedUseState(initial, "Component.tsx:4", "useToggle", "on");
        __trackedUseEffect(() => {
          console.log("toggled", on);
        }, [on], "Component.tsx:5", "useToggle", ["on"]);
        return [on, () => setOn(v => !v)];
      }"
    `);
  });

  it("leaves code unchanged when there are no hooks", () => {
    const code = `
      function Static() {
        return <div>hello</div>;
      }
    `;
    expect(transform(code)).toMatchInlineSnapshot(`
      "function Static() {
        return <div>hello</div>;
      }"
    `);
  });
});
