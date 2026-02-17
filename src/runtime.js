/// @ts-check

import { useState, useReducer, useEffect, useLayoutEffect, useRef } from "react";

/**
 * @typedef {{ location: string; componentName: string; changedDeps: string[] | null; depNames: string[] | null; stateWasSet: boolean }} EffectTracker
 * @typedef {{ message: string; time: number; type: "state-change" | "effect-run" | "slow-effect"; location: string; countKey: string }} LogEntry
 * @typedef {{ startTime: number; duration: number; processingStart: number; processingEnd: number; interactionId: number; name: string; entryType: string }} PerformanceEventTimingLike
 *
 * Log entry types:
 * - "state-change" — An effect called setState/dispatch, potentially causing a render loop.
 *                     These are always printed individually in the console.
 * - "effect-run"   — An effect ran but did NOT set state. Suppressed unless it falls inside
 *                     a Long Task or Slow Interaction, where it is included in the collapsed group for context.
 * - "slow-effect"  — An effect whose synchronous body took >= 8 ms. Always printed as a warning.
 */

/**
 * Typed accessors for global tracking state.
 * Avoids `globalThis` type issues while keeping the runtime mechanism simple.
 */
const globals =
  /** @type {{ __effectTracker: EffectTracker | null; __effectTrackerLogger?: (message: string) => void }} */ (
    /** @type {unknown} */ (globalThis)
  );

// ─── Logging with Long Task grouping ─────────────────────────────────

/** @type {LogEntry[]} */
const logBuffer = [];

/** @type {ReturnType<typeof setTimeout> | null} */
let flushTimer = null;

/**
 * Buffer a log entry. Custom loggers get immediate output (used by tests).
 * Otherwise entries are buffered and flushed — grouped by long tasks when available.
 * @param {string} message
 * @param {"state-change" | "effect-run" | "slow-effect"} [type]
 * @param {string} [location]
 * @param {string} [countKey]
 */
function log(message, type = "state-change", location = "", countKey = "") {
  // Custom logger → immediate (also used by tests)
  if (globals.__effectTrackerLogger) {
    globals.__effectTrackerLogger(message);
    return;
  }
  // Buffer for long task grouping
  if (typeof performance !== "undefined") {
    logBuffer.push({ message, time: performance.now(), type, location, countKey });
    scheduleFlush();
  } else {
    // No performance API (SSR) → immediate
    printSingle(type, message);
  }
}

function scheduleFlush() {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushBuffer();
  }, 100);
}

/**
 * Output a single message using the appropriate console method for the given type.
 * @param {"state-change" | "effect-run" | "slow-effect"} type
 * @param {string} formatted
 */
function printSingle(type, formatted) {
  if (type === "slow-effect") {
    console.warn(formatted);
  } else if (type === "effect-run") {
    console.info(formatted);
  } else {
    console.log(formatted);
  }
}

/**
 * Output a batch of log entries with [type] prefix and N/M counting per countKey.
 * Count is only shown when the same countKey appears more than once.
 * @param {LogEntry[]} entries
 */
function printEntries(entries) {
  // Count totals per countKey
  /** @type {Map<string, number>} */
  const totals = new Map();
  for (const entry of entries) {
    totals.set(entry.countKey, (totals.get(entry.countKey) || 0) + 1);
  }

  // Print each entry with running index
  /** @type {Map<string, number>} */
  const current = new Map();
  for (const entry of entries) {
    const idx = (current.get(entry.countKey) || 0) + 1;
    current.set(entry.countKey, idx);
    const total = totals.get(entry.countKey) || 1;
    const count = total > 1 ? ` ${idx}/${total}` : "";
    printSingle(entry.type, `[${entry.type}]${count} ${entry.message}`);
  }
}

/**
 * Flush all remaining buffered entries as individual log lines.
 */
function flushBuffer() {
  const toFlush = logBuffer.filter((entry) => entry.type !== "effect-run");
  printEntries(toFlush);
  logBuffer.length = 0;
}

/**
 * Start a PerformanceObserver for "longtask" entries.
 * Groups buffered log entries that fall within a long task (>50ms)
 * and outputs them as a collapsible console.group.
 */
function initLongTaskObserver() {
  if (typeof PerformanceObserver === "undefined") return;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const task of list.getEntries()) {
        const taskStart = task.startTime;
        const taskEnd = task.startTime + task.duration;

        // Partition buffer: before task, during task, after task
        /** @type {LogEntry[]} */
        const before = [];
        /** @type {LogEntry[]} */
        const during = [];
        /** @type {LogEntry[]} */
        const after = [];
        for (const entry of logBuffer) {
          if (entry.time < taskStart) before.push(entry);
          else if (entry.time <= taskEnd) during.push(entry);
          else after.push(entry);
        }

        // Flush entries before this task individually
        printEntries(before);

        // Group entries that happened during this long task
        if (during.length > 0) {
          const ms = Math.round(task.duration);
          const stateChanges = during.filter((entry) => entry.type === "state-change").length;
          const effectRuns = during.filter((entry) => entry.type !== "state-change").length;
          const parts = [];
          if (stateChanges > 0) parts.push(`${stateChanges} effect\u2192setState`);
          if (effectRuns > 0) parts.push(`${effectRuns} other effects`);
          console.groupCollapsed(`Long Task (${ms}ms) \u2014 ${parts.join(", ")}`);
          printEntries(during);
          console.groupEnd();
        }

        // Keep remaining entries for next processing
        logBuffer.length = 0;
        logBuffer.push(...after);
      }
    });
    observer.observe({ type: "longtask", buffered: true });
  } catch {
    // "longtask" not supported → fall back to timer-based flush
  }
}

initLongTaskObserver();

/**
 * Start a PerformanceObserver for "event" entries (INP).
 * Groups buffered log entries that fall within a slow interaction (>=200ms)
 * and outputs them as a collapsible console.group.
 */
function initINPObserver() {
  if (typeof PerformanceObserver === "undefined") return;
  try {
    const observer = new PerformanceObserver((list) => {
      /** @type {Map<number, PerformanceEventTimingLike[]>} */
      const interactions = new Map();

      for (const raw of list.getEntries()) {
        const entry = /** @type {PerformanceEventTimingLike} */ (/** @type {unknown} */ (raw));
        const id = entry.interactionId;
        if (!id) continue;
        let group = interactions.get(id);
        if (!group) {
          group = [];
          interactions.set(id, group);
        }
        group.push(entry);
      }

      for (const [, entries] of interactions) {
        const worst = entries.reduce((longest, curr) =>
          longest.duration > curr.duration ? longest : curr,
        );
        const procStart = worst.processingStart;
        const procEnd = worst.processingEnd;

        /** @type {LogEntry[]} */
        const before = [];
        /** @type {LogEntry[]} */
        const during = [];
        /** @type {LogEntry[]} */
        const after = [];
        for (const entry of logBuffer) {
          if (entry.time < procStart) before.push(entry);
          else if (entry.time <= procEnd) during.push(entry);
          else after.push(entry);
        }

        printEntries(before.filter((entry) => entry.type !== "effect-run"));

        if (during.length > 0) {
          const ms = Math.round(worst.duration);
          const stateChanges = during.filter((entry) => entry.type === "state-change").length;
          const effectRuns = during.filter((entry) => entry.type !== "state-change").length;
          const parts = [];
          if (stateChanges > 0) parts.push(`${stateChanges} effect\u2192setState`);
          if (effectRuns > 0) parts.push(`${effectRuns} other effects`);
          console.groupCollapsed(
            `Slow Interaction: ${worst.name} (${ms}ms) \u2014 ${parts.join(", ")}`,
          );
          printEntries(during);
          console.groupEnd();
        }

        logBuffer.length = 0;
        logBuffer.push(...after);
      }
    });
    observer.observe({ type: "event", durationThreshold: 200, buffered: true });
  } catch {
    // "event" observer type not supported → no INP grouping
  }
}

initINPObserver();

// ─── Dependency diffing ──────────────────────────────────────────────

/**
 * Determines which dependencies changed by comparing previous vs current.
 * @param {ReadonlyArray<unknown> | undefined} prevDeps
 * @param {ReadonlyArray<unknown> | undefined} currentDeps
 * @param {string[] | null} depNames
 * @returns {string[] | null}
 */
function getChangedDeps(prevDeps, currentDeps, depNames) {
  if (!prevDeps || !depNames || !currentDeps) return null;
  /** @type {string[]} */
  const changed = [];
  for (let i = 0; i < currentDeps.length; i++) {
    if (!Object.is(prevDeps[i], currentDeps[i])) {
      changed.push(depNames[i] || `dep[${i}]`);
    }
  }
  return changed;
}

// ─── Tracked hooks ───────────────────────────────────────────────────

/** @type {WeakMap<Function, { wrapper: Function, meta: { location: string, componentName: string, stateName: string } }>} */
const stateTrackerMap = new WeakMap();

/** @type {WeakMap<Function, { wrapper: Function, meta: { location: string, componentName: string, stateName: string } }>} */
const reducerTrackerMap = new WeakMap();

/**
 * @template T
 * @param {T | (() => T)} initialValue
 * @param {string} location
 * @param {string} componentName
 * @param {string} stateName
 * @returns {[T, (value: T | ((prev: T) => T)) => void]}
 */
export function __trackedUseState(initialValue, location, componentName, stateName) {
  const [state, rawSetState] = useState(initialValue);

  let tracked = stateTrackerMap.get(rawSetState);
  if (!tracked) {
    const meta = { location, componentName, stateName };
    let value =
      typeof initialValue === "function" ? /** @type {() => T} */ (initialValue)() : initialValue;
    const wrapper = (/** @type {T | ((prev: T) => T)} */ valueOrUpdater) => {
      const newValue =
        typeof valueOrUpdater === "function"
          ? /** @type {(prev: T) => T} */ (valueOrUpdater)(value)
          : valueOrUpdater;
      const tracker = globals.__effectTracker;

      if (tracker) {
        if (value !== newValue) {
          tracker.stateWasSet = true;
          const reason =
            tracker.changedDeps === null
              ? "it was initially mounted"
              : tracker.changedDeps.length === 0
                ? "it re-ran (no deps changed detected)"
                : `${tracker.changedDeps.join(", ")} changed`;

          log(
            `useEffect ${tracker.location} in ${tracker.componentName} ` +
              `changed useState "${meta.stateName}" because ${reason}`,
            "state-change",
            tracker.location,
            `${tracker.location}:${tracker.componentName}`,
          );
        }
      }
      value = newValue;
      rawSetState(valueOrUpdater);
    };
    tracked = { wrapper, meta };
    stateTrackerMap.set(rawSetState, tracked);
  }

  return [state, /** @type {(value: T | ((prev: T) => T)) => void} */ (tracked.wrapper)];
}

/**
 * @template S
 * @template A
 * @param {(state: S, action: A) => S} reducer
 * @param {any} initialArg
 * @param {((arg: any) => S) | undefined} init
 * @param {string} location
 * @param {string} componentName
 * @param {string} stateName
 * @returns {[S, (action: A) => void]}
 */
export function __trackedUseReducer(reducer, initialArg, init, location, componentName, stateName) {
  const [state, rawDispatch] = init
    ? useReducer(reducer, initialArg, init)
    : useReducer(reducer, initialArg);

  let tracked = reducerTrackerMap.get(rawDispatch);
  if (!tracked) {
    const meta = { location, componentName, stateName };
    let trackedState = state;
    const wrapper = (/** @type {A} */ action) => {
      const nextState = reducer(trackedState, action);
      const tracker = globals.__effectTracker;

      if (tracker && trackedState !== nextState) {
        tracker.stateWasSet = true;
        const reason =
          tracker.changedDeps === null
            ? "it was initially mounted"
            : tracker.changedDeps.length === 0
              ? "it re-ran (no deps changed detected)"
              : `${tracker.changedDeps.join(", ")} changed`;

        log(
          `useEffect ${tracker.location} in ${tracker.componentName} ` +
            `changed useReducer "${meta.stateName}" because ${reason}`,
          "state-change",
          tracker.location,
          `${tracker.location}:${tracker.componentName}`,
        );
      }

      trackedState = nextState;
      rawDispatch(action);
    };
    tracked = { wrapper, meta };
    reducerTrackerMap.set(rawDispatch, tracked);
  }

  return [state, /** @type {(action: A) => void} */ (tracked.wrapper)];
}

/**
 * Shared implementation for tracked effect hooks.
 * @param {(effect: React.EffectCallback, deps?: React.DependencyList) => void} effectHook
 * @param {() => (void | (() => void))} callback
 * @param {ReadonlyArray<unknown> | undefined} deps
 * @param {string} location
 * @param {string} componentName
 * @param {string[] | null} depNames
 */
function trackedEffectImpl(effectHook, callback, deps, location, componentName, depNames) {
  /** @type {{ current: ReadonlyArray<unknown> | undefined }} */
  const prevDepsRef = useRef(undefined);
  const isInitialRef = useRef(true);

  effectHook(() => {
    /** @type {string[] | null} */
    let changedDeps = null;

    if (isInitialRef.current) {
      changedDeps = null;
      isInitialRef.current = false;
    } else {
      changedDeps = getChangedDeps(prevDepsRef.current, deps, depNames);
      if (changedDeps === null) changedDeps = [];
    }

    prevDepsRef.current = deps ? [...deps] : undefined;

    const previousTracker = globals.__effectTracker;
    /** @type {EffectTracker} */
    const tracker = {
      location,
      componentName,
      changedDeps,
      depNames,
      stateWasSet: false,
    };
    globals.__effectTracker = tracker;

    /** @type {void | (() => void)} */
    let cleanup;
    const startTime = typeof performance !== "undefined" ? performance.now() : 0;
    try {
      cleanup = callback();
    } finally {
      globals.__effectTracker = previousTracker;
    }

    // Slow effect detection (>=8ms)
    if (startTime > 0) {
      const duration = performance.now() - startTime;
      if (duration >= 8) {
        log(
          `Slow effect: useEffect ${location} in ${componentName} took ${Math.round(duration)}ms`,
          "slow-effect",
          location,
          `${location}:${componentName}`,
        );
      }
    }

    // Non-loop effects: log for long task visibility only
    if (!tracker.stateWasSet) {
      const reason =
        changedDeps === null
          ? "it was initially mounted"
          : changedDeps.length === 0
            ? "it re-ran (no deps changed detected)"
            : `${changedDeps.join(", ")} changed`;
      log(
        `useEffect ${location} in ${componentName} ran because ${reason}`,
        "effect-run",
        location,
        `${location}:${componentName}`,
      );
    }

    return cleanup;
  }, deps);
}

/**
 * @param {() => (void | (() => void))} callback
 * @param {ReadonlyArray<unknown> | undefined} deps
 * @param {string} location
 * @param {string} componentName
 * @param {string[] | null} depNames
 */
export function __trackedUseEffect(callback, deps, location, componentName, depNames) {
  trackedEffectImpl(useEffect, callback, deps, location, componentName, depNames);
}

/**
 * @param {() => (void | (() => void))} callback
 * @param {ReadonlyArray<unknown> | undefined} deps
 * @param {string} location
 * @param {string} componentName
 * @param {string[] | null} depNames
 */
export function __trackedUseLayoutEffect(callback, deps, location, componentName, depNames) {
  trackedEffectImpl(useLayoutEffect, callback, deps, location, componentName, depNames);
}
