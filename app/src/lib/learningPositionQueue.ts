type PositionWrite = {
  execute: () => Promise<void>;
  skip: () => void;
};
type PositionQueue = { pending?: PositionWrite };

const positionQueues = new Map<string, PositionQueue>();

// Order this tab's writes only. Other tabs remain last accepted save.
export function queueLearningPosition<T>(
  key: string,
  isCurrent: () => boolean,
  write: () => Promise<T>
): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const operation: PositionWrite = {
      skip: () => resolve(null),
      execute: async () => {
        try {
          resolve(isCurrent() ? await write() : null);
        } catch (error) {
          reject(error);
        }
      },
    };
    const existing = positionQueues.get(key);

    if (existing) {
      existing.pending?.skip();
      existing.pending = operation;
      return;
    }

    const queue: PositionQueue = {};
    positionQueues.set(key, queue);
    void drainPositionQueue(key, queue, operation);
  });
}

async function drainPositionQueue(
  key: string,
  queue: PositionQueue,
  first: PositionWrite
) {
  let operation: PositionWrite | undefined = first;

  while (operation) {
    await operation.execute();
    operation = queue.pending;
    queue.pending = undefined;
  }

  positionQueues.delete(key);
}
