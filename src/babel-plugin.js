/// @ts-check

/**
 * Babel Plugin: react-render-loop-tracer
 *
 * Transforms:
 *   const [count, setCount] = useState(0)
 * Into:
 *   const [count, setCount] = __trackedUseState(0, "file.tsx:5", "MyComponent", "count")
 *
 * Transforms:
 *   useEffect(() => { ... }, [x, y])
 * Into:
 *   __trackedUseEffect(() => { ... }, [x, y], "file.tsx:10", "MyComponent", ["x", "y"])
 *
 * Transforms:
 *   const [state, dispatch] = useReducer(reducer, initialState)
 * Into:
 *   const [state, dispatch] = __trackedUseReducer(reducer, initialState, undefined, "file.tsx:8", "MyComponent", "state")
 *
 * Injects the import for the tracking wrappers at the top of the file.
 *
 * @param {import("@babel/core")} api
 * @returns {import("@babel/core").PluginObj}
 */
export default function reactRenderLoopTracerPlugin({ types: t }) {
  /**
   * Walk up the AST to find the enclosing React component name.
   * @param {import("@babel/traverse").NodePath} path
   * @returns {string}
   */
  function getComponentName(path) {
    /** @type {import("@babel/traverse").NodePath | null} */
    let current = path;
    while (current) {
      if (current.isFunctionDeclaration() && current.node.id) {
        return current.node.id.name;
      }
      if (current.isVariableDeclarator() && t.isIdentifier(current.node.id)) {
        return current.node.id.name;
      }
      if (
        (current.isArrowFunctionExpression() || current.isFunctionExpression()) &&
        current.parentPath?.isVariableDeclarator()
      ) {
        const id = /** @type {import("@babel/types").VariableDeclarator} */ (
          current.parentPath.node
        ).id;
        return t.isIdentifier(id) ? id.name : "Anonymous";
      }
      if (current.isExportDefaultDeclaration()) {
        const decl = current.node.declaration;
        if (t.isFunctionDeclaration(decl) && decl.id) {
          return decl.id.name;
        }
        return "DefaultExport";
      }
      current = current.parentPath;
    }
    return "Unknown";
  }

  /**
   * Get the state variable name from the destructuring pattern.
   * `const [count, setCount] = useState(...)` → `"count"`
   * @param {import("@babel/traverse").NodePath<import("@babel/types").CallExpression>} callPath
   * @returns {string | null}
   */
  function getStateNameFromDeclarator(callPath) {
    const declarator = callPath.parentPath;
    if (!declarator?.isVariableDeclarator()) return null;
    const id = declarator.node.id;
    if (t.isArrayPattern(id) && id.elements.length >= 1 && t.isIdentifier(id.elements[0])) {
      return id.elements[0].name;
    }
    return null;
  }

  /**
   * Stringify dependency array items.
   * `[x, y, props.foo]` → `["x", "y", "props.foo"]`
   * @param {import("@babel/types").Node | undefined} depsNode
   * @returns {string[] | null}
   */
  function stringifyDeps(depsNode) {
    if (!depsNode || !t.isArrayExpression(depsNode)) return null;
    return depsNode.elements.map((el) => {
      if (!el) return "complex";
      if (t.isIdentifier(el)) return el.name;
      if (t.isMemberExpression(el)) return memberExpressionToString(el);
      return "complex";
    });
  }

  /**
   * @param {import("@babel/types").Node} node
   * @returns {string}
   */
  function memberExpressionToString(node) {
    if (t.isIdentifier(node)) return node.name;
    if (t.isMemberExpression(node)) {
      const obj = memberExpressionToString(node.object);
      const prop = node.computed
        ? `[${memberExpressionToString(node.property)}]`
        : `.${/** @type {import("@babel/types").Identifier} */ (node.property).name}`;
      return obj + prop;
    }
    return "complex";
  }

  /**
   * Check if a callee matches `useEffect` or `React.useEffect`.
   * @param {import("@babel/types").Node} callee
   * @param {string} hookName
   * @returns {boolean}
   */
  function isHookCall(callee, hookName) {
    if (t.isIdentifier(callee) && callee.name === hookName) return true;
    if (
      t.isMemberExpression(callee) &&
      t.isIdentifier(callee.property) &&
      callee.property.name === hookName
    ) {
      return true;
    }
    return false;
  }

  return {
    name: "react-render-loop-tracer",
    visitor: {
      Program: {
        enter(_path, state) {
          state.needsImport = false;
          state.hasUseState = false;
          state.hasUseReducer = false;
          state.hasUseEffect = false;
          state.hasUseLayoutEffect = false;
        },
        exit(path, state) {
          if (!state.needsImport) return;

          /** @type {string[]} */
          const names = [];
          if (state.hasUseState) names.push("__trackedUseState");
          if (state.hasUseReducer) names.push("__trackedUseReducer");
          if (state.hasUseEffect) names.push("__trackedUseEffect");
          if (state.hasUseLayoutEffect) names.push("__trackedUseLayoutEffect");

          if (names.length === 0) return;

          const source = t.stringLiteral("@jantimon/react-render-loop-tracer/runtime");
          const isCJS = path.node.sourceType === "script";

          if (isCJS) {
            // const { __trackedUseState, ... } = require("...")
            const requireDecl = t.variableDeclaration("const", [
              t.variableDeclarator(
                t.objectPattern(
                  names.map((name) =>
                    t.objectProperty(t.identifier(name), t.identifier(name), false, true),
                  ),
                ),
                t.callExpression(t.identifier("require"), [source]),
              ),
            ]);
            path.unshiftContainer("body", requireDecl);
          } else {
            const importDecl = t.importDeclaration(
              names.map((name) => t.importSpecifier(t.identifier(name), t.identifier(name))),
              source,
            );
            path.unshiftContainer("body", importDecl);
          }
        },
      },

      CallExpression(path, state) {
        const { callee } = path.node;
        const filename = state.filename || state.file?.opts?.filename || "unknown";
        const shortFilename = filename.split("/").pop() || filename;

        // ─── useState ───
        if (isHookCall(callee, "useState")) {
          const line = path.node.loc?.start?.line ?? "?";
          const componentName = getComponentName(path);
          const stateName = getStateNameFromDeclarator(path) || "anonymous";

          const args = path.node.arguments;
          const initialValue = args[0] || t.identifier("undefined");

          path.replaceWith(
            t.callExpression(t.identifier("__trackedUseState"), [
              /** @type {import("@babel/types").Expression} */ (initialValue),
              t.stringLiteral(`${shortFilename}:${line}`),
              t.stringLiteral(componentName),
              t.stringLiteral(stateName),
            ]),
          );

          state.needsImport = true;
          state.hasUseState = true;
          return;
        }

        // ─── useReducer ───
        if (isHookCall(callee, "useReducer")) {
          const line = path.node.loc?.start?.line ?? "?";
          const componentName = getComponentName(path);
          const stateName = getStateNameFromDeclarator(path) || "anonymous";

          const args = path.node.arguments;
          const reducer = args[0] || t.identifier("undefined");
          const initialArg = args[1] || t.identifier("undefined");
          const init = args[2] || t.identifier("undefined");

          path.replaceWith(
            t.callExpression(t.identifier("__trackedUseReducer"), [
              /** @type {import("@babel/types").Expression} */ (reducer),
              /** @type {import("@babel/types").Expression} */ (initialArg),
              /** @type {import("@babel/types").Expression} */ (init),
              t.stringLiteral(`${shortFilename}:${line}`),
              t.stringLiteral(componentName),
              t.stringLiteral(stateName),
            ]),
          );

          state.needsImport = true;
          state.hasUseReducer = true;
          return;
        }

        // ─── useEffect / useLayoutEffect ───
        const isEffect = isHookCall(callee, "useEffect");
        const isLayoutEffect = isHookCall(callee, "useLayoutEffect");

        if (isEffect || isLayoutEffect) {
          const line = path.node.loc?.start?.line ?? "?";
          const componentName = getComponentName(path);
          const args = path.node.arguments;
          const callback = args[0];
          const deps = args[1];

          const depNames = stringifyDeps(
            /** @type {import("@babel/types").Node | undefined} */ (deps),
          );
          const depNamesArg = depNames
            ? t.arrayExpression(depNames.map((d) => t.stringLiteral(d)))
            : t.nullLiteral();

          const wrapperName = isEffect ? "__trackedUseEffect" : "__trackedUseLayoutEffect";

          const newArgs = [
            /** @type {import("@babel/types").Expression} */ (
              callback || t.identifier("undefined")
            ),
            /** @type {import("@babel/types").Expression} */ (deps || t.identifier("undefined")),
            t.stringLiteral(`${shortFilename}:${line}`),
            t.stringLiteral(componentName),
            depNamesArg,
          ];

          path.replaceWith(t.callExpression(t.identifier(wrapperName), newArgs));

          state.needsImport = true;
          if (isEffect) state.hasUseEffect = true;
          if (isLayoutEffect) state.hasUseLayoutEffect = true;
          return;
        }
      },
    },
  };
}
