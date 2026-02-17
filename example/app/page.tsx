"use client";

import { useState, useEffect } from "react";

export default function Page() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (count < 10) {
      setCount(count + 1);
      const time = Date.now();
      while (Date.now() - time < 2) {}
    }
  }, [count]);

  useEffect(() => {
    const time = Date.now();
    while (Date.now() - time < 10) {}
  }, []);

  return (
    <div style={{ fontFamily: "monospace", padding: 40 }}>
      <h1>Render Loop Tracer Example</h1>
      <p>
        Re-render count: <strong>{count}</strong> / 10
      </p>
      {count >= 10 && <p>Done!</p>}
    </div>
  );
}
