import type EventEmitter from "node:events";

declare global {
  interface Map<K, V> {
    getOrInsert(key: K, fallback: V): V;
  }

  interface Array<T> {
    partialMap<S>(fn: (val: T) => S | undefined): S[];
  }
}

declare module "node:events" {
  interface EventEmitter {
    after(event: string): any;
  }
}

Map.prototype.getOrInsert = function getOrInsert<K, V>(
  this: Map<K, V>,
  key: K,
  fallback: V,
): V {
  const val = this.get(key);
  return val ? val : (this.set(key, fallback), fallback);
};

Array.prototype.partialMap = function partialMap<T, S>(
  this: T[],
  fn: (val: T) => S | undefined,
): S[] {
  const arr: S[] = [];
  for (let el of this) {
    const res = fn(el);
    if (res !== undefined) arr.push(res);
  }
  return arr;
};

export function after(emitter: EventEmitter, event: string): any {
  return new Promise(res => emitter.once(event, res));
}

export function cleanInsert<K extends string | number | symbol, V>(
  key: K,
  value: V,
): {} | { [k in K]: V } {
  return value ? { [key]: value } : {};
}
