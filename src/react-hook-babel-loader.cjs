/// @ts-check

const path = require("path");
const babelLoader = require("babel-loader");

const ignoredFolders = [
  "/node_modules/react-dom/",
  "/node_modules/react/",
  "/compiled/react-dom/",
  "/compiled/react/",
  "/compiled/react-server-dom-webpack/",
  "compiled/next-devtools/",
  "react-refresh/cjs/react-refresh-runtime.development.js",
].map((folder) => folder.split("/").join(path.sep));

/**
 * Custom loader that skips babel entirely if the source
 * doesn't reference "react" at all.
 *
 * @this {import("webpack").LoaderContext<{ plugins: string[], presets: unknown[], parserOpts: Record<string, unknown> }>}
 * @param {string} source
 * @param {Parameters<import("webpack").LoaderDefinitionFunction>[1]} [sourceMap]
 */
module.exports = function reactHookBabelLoader(source, sourceMap) {
  // ignore react packages
  if (ignoredFolders.some((folder) => this.resourcePath.includes(folder))) {
    this.callback(null, source, sourceMap);
    return;
  }

  if (!source.includes("react")) {
    this.callback(null, source, sourceMap);
    return;
  }

  // skip files already transformed by the plugin
  if (
    source.includes("__trackedUseState") ||
    source.includes("__trackedUseReducer") ||
    source.includes("__trackedUseEffect") ||
    source.includes("__trackedUseLayoutEffect")
  ) {
    this.callback(null, source, sourceMap);
    return;
  }

  // Delegate to babel-loader with the same options
  return babelLoader.call(this, source, sourceMap);
};
