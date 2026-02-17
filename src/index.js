/// @ts-check

import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * @typedef {object} WebpackConfig
 * @property {{ rules: object[] }} module
 * @property {{ alias?: Record<string, string> }} resolve
 */

/**
 * @typedef {object} WebpackContext
 * @property {boolean} isServer
 * @property {boolean} [dev]
 */

/**
 * Wraps a Next.js config to add React render loop tracing.
 *
 * Usage in next.config.mjs:
 *
 *   import { withRenderLoopTracer } from "@jantimon/react-render-loop-tracer";
 *   export default withRenderLoopTracer({ ... });
 *
 * @param {Record<string, any> & { webpack?: (config: WebpackConfig, context: WebpackContext) => WebpackConfig }} nextConfig
 * @returns {Record<string, any> & { webpack: (config: WebpackConfig, context: WebpackContext) => WebpackConfig }}
 */
export function withRenderLoopTracer(nextConfig = {}) {
  const originalWebpack = nextConfig.webpack;

  const loaderConfig = {
    loader:
      "./" + path.relative(process.cwd(), path.resolve(__dirname, "./react-hook-babel-loader.cjs")),
    options: {
      plugins: [path.resolve(__dirname, "./babel-plugin.js")],
      presets: [],
      parserOpts: { plugins: ["jsx", "typescript"] },
      sourceType: "unambiguous",
    },
  };

  const turboRules = {
    "*.jsx": { loaders: [loaderConfig], as: "*.jsx" },
    "*.tsx": { loaders: [loaderConfig], as: "*.tsx" },
  };

  return {
    ...nextConfig,
    turbopack: {
      ...nextConfig.turbopack,
      rules: { ...nextConfig.turbopack?.rules, ...turboRules },
    },
    /** @param {WebpackConfig} config @param {WebpackContext} context */
    webpack(config, context) {
      if (!context.isServer) {
        config.module.rules.push({
          test: /\.(j|t)sx?$/,
          enforce: "pre",
          use: loaderConfig,
        });
      }

      return originalWebpack ? originalWebpack(config, context) : config;
    },
  };
}
