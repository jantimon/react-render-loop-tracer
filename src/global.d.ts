/** Augment DOM lib: PerformanceObserver supports durationThreshold for event timing */
interface PerformanceObserverInit {
  durationThreshold?: number;
}

/** Ambient module declaration for babel-loader (no bundled types) */
declare module "babel-loader" {
  import type { LoaderDefinitionFunction } from "webpack";
  const loader: LoaderDefinitionFunction;
  export = loader;
}

declare var __effectTracker: {
  location: string;
  componentName: string;
  changedDeps: string[] | null;
  depNames: string[] | null;
  stateWasSet: boolean;
} | null;

declare var __effectTrackerLogger: ((message: string) => void) | undefined;
