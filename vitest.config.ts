import { defineConfig } from "vitest/config";
import path from "path";
import babel from "vite-plugin-babel";

export default defineConfig({
  plugins: [
    babel({
      babelConfig: {
        plugins: [path.resolve(__dirname, "./src/babel-plugin.js")],
        presets: [["@babel/preset-react", { runtime: "automatic" }], "@babel/preset-typescript"],
      },
      filter: /\.[jt]sx$/,
    }),
  ],
  resolve: {
    alias: {
      "@jantimon/react-render-loop-tracer/runtime": path.resolve(__dirname, "./src/runtime.js"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.js"],
  },
});
