const TRANSFER_MARKER = '__comlinkTransfer';

export interface TransferWrapper<T> {
  value: T;
  transfers: Transferable[];
  [TRANSFER_MARKER]: true;
}

const isTransferWrapper = (value: unknown): value is TransferWrapper<unknown> => {
  return Boolean(value) && typeof value === 'object' && (value as Record<string, unknown>)[TRANSFER_MARKER] === true;
};

export const transfer = <T>(value: T, transfers: Transferable[]): TransferWrapper<T> => ({
  value,
  transfers,
  [TRANSFER_MARKER]: true
});

const unwrapArgs = (args: unknown[]) => {
  const plainArgs: unknown[] = [];
  const transfers: Transferable[] = [];
  for (const arg of args) {
    if (isTransferWrapper(arg)) {
      plainArgs.push(arg.value);
      if (Array.isArray(arg.transfers)) {
        transfers.push(...arg.transfers);
      }
    } else {
      plainArgs.push(arg);
    }
  }
  return { plainArgs, transfers };
};

const wrapResult = (value: unknown) => {
  if (isTransferWrapper(value)) {
    return { result: value.value, transfers: value.transfers ?? [] };
  }
  return { result: value, transfers: [] as Transferable[] };
};

const serializeError = (error: unknown) => {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  return { message: String(error) };
};

const deserializeError = (error: unknown) => {
  if (error && typeof error === 'object' && 'message' in error) {
    const payload = error as { message?: unknown; stack?: unknown };
    const err = new Error(typeof payload.message === 'string' ? payload.message : 'Worker error');
    if (typeof payload.stack === 'string') {
      err.stack = payload.stack;
    }
    return err;
  }
  return new Error('Worker error');
};

export const releaseProxy = Symbol('comlink.releaseProxy');

export interface Endpoint {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

export const wrap = <T extends object>(endpoint: Endpoint): T => {
  let idCounter = 0;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>();

  const handleMessage = (event: MessageEvent) => {
    const data = event.data as { type?: string; id?: number; value?: unknown; error?: unknown };
    if (!data || typeof data !== 'object') {
      return;
    }
    if (data.type === 'resolve' || data.type === 'reject') {
      if (typeof data.id !== 'number') return;
      const entry = pending.get(data.id);
      if (!entry) return;
      pending.delete(data.id);
      if (data.type === 'resolve') {
        entry.resolve(data.value);
      } else {
        entry.reject(deserializeError(data.error));
      }
    }
  };

  endpoint.addEventListener('message', handleMessage);

  const call = (property: PropertyKey, args: unknown[]) => {
    const id = idCounter++;
    const { plainArgs, transfers } = unwrapArgs(args);
    const method = typeof property === 'string' ? property : property.toString();
    const promise = new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    endpoint.postMessage({ type: 'call', id, method, args: plainArgs }, transfers);
    return promise;
  };

  return new Proxy(
    {},
    {
      get(_, property) {
        if (property === releaseProxy) {
          return () => {
            endpoint.postMessage({ type: 'release' });
            endpoint.removeEventListener('message', handleMessage);
            for (const [, entry] of pending) {
              entry.reject(new Error('Proxy released'));
            }
            pending.clear();
          };
        }
        return (...args: unknown[]) => call(property, args);
      }
    }
  ) as T;
};

export const expose = (
  api: Record<PropertyKey, (...args: unknown[]) => unknown>,
  endpoint: Endpoint = self as unknown as Endpoint
) => {
  const handleMessage = async (event: MessageEvent) => {
    const data = event.data as { type?: string; id?: number; method?: string; args?: unknown[] };
    if (!data || typeof data !== 'object') {
      return;
    }

    if (data.type === 'call') {
      const methodName = data.method ?? '';
      const target = api[methodName as keyof typeof api];
      if (typeof target !== 'function') {
        (endpoint as Endpoint).postMessage({
          type: 'reject',
          id: data.id,
          error: { message: `Unknown method: ${methodName}` }
        });
        return;
      }
      try {
        const value = await target(...(data.args ?? []));
        const { result, transfers } = wrapResult(value);
        (endpoint as Endpoint).postMessage({ type: 'resolve', id: data.id, value: result }, transfers);
      } catch (error) {
        (endpoint as Endpoint).postMessage({ type: 'reject', id: data.id, error: serializeError(error) });
      }
    } else if (data.type === 'release') {
      if (typeof (api as Record<PropertyKey, unknown>)[releaseProxy as unknown as keyof typeof api] === 'function') {
        (api as Record<PropertyKey, () => void>)[releaseProxy as unknown as keyof typeof api]!();
      }
      endpoint.removeEventListener('message', handleMessage);
    }
  };

  endpoint.addEventListener('message', handleMessage);
};
