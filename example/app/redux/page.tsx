"use client";

import { useEffect } from "react";
import { Provider, useSelector, useDispatch } from "react-redux";
import { store, type RootState } from "./store";

function Counter() {
  const count = useSelector((s: RootState) => s.count);
  const dispatch = useDispatch();

  useEffect(() => {
    if (count < 10) {
      dispatch({ type: "INCREMENT" });
    }
  }, [count, dispatch]);

  useEffect(() => {
    dispatch({ type: "SET", value: 0 });
  }, [dispatch]);

  return (
    <div style={{ fontFamily: "monospace", padding: 40 }}>
      <h1>Redux Render Loop Example</h1>
      <p>
        Re-render count: <strong>{count}</strong> / 10
      </p>
      <button onClick={() => dispatch({ type: "INCREMENT" })}>Increment</button>
      {count >= 10 && <p>Done!</p>}
    </div>
  );
}

export default function ReduxPage() {
  return (
    <Provider store={store}>
      <Counter />
    </Provider>
  );
}
