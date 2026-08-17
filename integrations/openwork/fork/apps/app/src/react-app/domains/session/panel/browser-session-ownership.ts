export type BrowserSessionActivationToken = {
  sessionId: string;
  requestId: number;
};

let latestRequestId = 0;
let ownerSessionId: string | null = null;
let pendingSessionId: string | null = null;
let activationQueue: Promise<void> = Promise.resolve();

export function browserSessionOwner() {
  return ownerSessionId;
}

export function browserSessionIsOwnedBy(sessionId: string) {
  return Boolean(sessionId) && ownerSessionId === sessionId;
}

export function browserSessionActivationIsCurrent(token: BrowserSessionActivationToken) {
  return token.requestId === latestRequestId && token.sessionId === pendingSessionId;
}

export async function activateBrowserSession<T>(
  sessionId: string,
  restore: (isCurrent: () => boolean) => Promise<T>,
  isAuthorized: () => boolean = () => true,
): Promise<T | null> {
  const token: BrowserSessionActivationToken = {
    sessionId,
    requestId: ++latestRequestId,
  };
  pendingSessionId = sessionId;
  ownerSessionId = null;

  const previous = activationQueue;
  let releaseQueue!: () => void;
  activationQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });

  await previous;
  try {
    const isCurrent = () => (
      browserSessionActivationIsCurrent(token) && isAuthorized()
    );
    if (!isCurrent()) return null;
    const result = await restore(isCurrent);
    if (!isCurrent()) return null;
    ownerSessionId = sessionId;
    pendingSessionId = null;
    return result;
  } finally {
    releaseQueue();
  }
}

export function releaseBrowserSession(sessionId: string) {
  if (ownerSessionId !== sessionId && pendingSessionId !== sessionId) return;
  latestRequestId += 1;
  ownerSessionId = null;
  pendingSessionId = null;
}

export function resetBrowserSessionOwnershipForTests() {
  latestRequestId = 0;
  ownerSessionId = null;
  pendingSessionId = null;
  activationQueue = Promise.resolve();
}
