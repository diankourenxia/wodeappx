export type ActionExecutionQueue = {
  enqueue<T>(run: () => Promise<T>): Promise<T>;
};

export function createActionExecutionQueue(): ActionExecutionQueue {
  let tail: Promise<void> = Promise.resolve();

  return {
    enqueue<T>(run: () => Promise<T>): Promise<T> {
      const queued = tail
        .catch(() => undefined)
        .then(run);
      tail = queued.then(
        () => undefined,
        () => undefined,
      );
      return queued;
    },
  };
}
