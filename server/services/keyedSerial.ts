export type KeyedSerialExecutor = <T>(key: string, operation: () => Promise<T>) => Promise<T>;

export function createKeyedSerialExecutor(): KeyedSerialExecutor {
  const tails = new Map<string, Promise<void>>();

  return async function runSerially<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => current);
    tails.set(key, tail);

    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (tails.get(key) === tail) tails.delete(key);
    }
  };
}
