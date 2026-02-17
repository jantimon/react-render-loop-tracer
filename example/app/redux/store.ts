import { createStore } from "redux";

export interface RootState {
  count: number;
}

type Action = { type: "INCREMENT" } | { type: "SET"; value: number };

function reducer(state: RootState = { count: 0 }, action: Action): RootState {
  switch (action.type) {
    case "INCREMENT":
      return { count: state.count + 1 };
    case "SET":
      return { count: action.value };
    default:
      return state;
  }
}

export const store = createStore(reducer);
