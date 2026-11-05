import type { Cart } from './cartModel';

/**
 * Where the cart lives on the device (REQ-050): IndexedDB in the browser,
 * localStorage where IndexedDB is missing, memory in tests. Never the server.
 */
export interface CartStore {
  load(key: string): Promise<Cart | null>;
  save(cart: Cart): Promise<void>;
}

const DB = 'dhaba-pos';
const STORE = 'carts';

function isCart(v: unknown): v is Cart {
  return !!v && typeof v === 'object' && Array.isArray((v as Cart).lines) && Array.isArray((v as Cart).sent);
}

export function memoryCartStore(): CartStore & { data: Map<string, Cart> } {
  const data = new Map<string, Cart>();
  return {
    data,
    load: async (key) => structuredClone(data.get(key) ?? null),
    save: async (cart) => { data.set(cart.key, structuredClone(cart)); },
  };
}

export function localCartStore(storage: Storage = localStorage): CartStore {
  const k = (key: string) => `dhaba.cart.${key}`;
  return {
    load: async (key) => {
      try {
        const v: unknown = JSON.parse(storage.getItem(k(key)) ?? 'null');
        return isCart(v) ? v : null;
      } catch {
        return null;
      }
    },
    save: async (cart) => { storage.setItem(k(cart.key), JSON.stringify(cart)); },
  };
}

export function indexedDbCartStore(idb: IDBFactory = indexedDB): CartStore {
  let db: Promise<IDBDatabase> | null = null;
  const open = () => {
    db ??= new Promise((resolve, reject) => {
      const req = idb.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return db;
  };
  const run = async <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) => {
    const d = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = d.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    });
  };
  return {
    load: async (key) => {
      const v = await run<unknown>('readonly', (s) => s.get(key));
      return isCart(v) ? v : null;
    },
    save: async (cart) => { await run('readwrite', (s) => s.put(cart)); },
  };
}

/** The device's cart store: IndexedDB when the browser has it. */
export function defaultCartStore(): CartStore {
  return typeof indexedDB !== 'undefined' ? indexedDbCartStore() : localCartStore();
}
