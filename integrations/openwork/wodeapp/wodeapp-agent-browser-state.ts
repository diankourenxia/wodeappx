import * as React from "react";

let agentBrowserActive = false;
const listeners = new Set<() => void>();

export function setWodeAppAgentBrowserActive(active: boolean) {
  if (agentBrowserActive === active) return;
  agentBrowserActive = active;
  listeners.forEach((listener) => listener());
}

export function isWodeAppAgentBrowserActive() {
  return agentBrowserActive;
}

export function subscribeWodeAppAgentBrowserActive(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useWodeAppAgentBrowserActive() {
  const [active, setActive] = React.useState(agentBrowserActive);

  React.useEffect(() => subscribeWodeAppAgentBrowserActive(() => {
    setActive(agentBrowserActive);
  }), []);

  return active;
}

