/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {SIGNAL} from '../../../../primitives/signals';
import type {ReactiveNode} from '../../../../primitives/signals';
import {isSignal} from '../../../render3/reactivity/api';
import {stripLeadingUnderscore} from './names';

/** Strings longer than this are cut. */
const MAX_STRING_LENGTH = 200;

/** Number of entries listed for each expanded object, array, `Map` or `Set`. */
const MAX_COLLECTION_ENTRIES = 30;

/**
 * Number of objects, arrays, `Map`s, `Set`s and signals one `serializeValue` call expands. Further
 * ones are replaced by a one-line preview.
 */
const MAX_SERIALIZED_NODES = 500;

/** Number of levels of nesting expanded by default. */
const DEFAULT_DEPTH = 1;

/** Largest number of levels of nesting a caller may ask for. */
const MAX_DEPTH = 5;

const CIRCULAR = '[circular]';

/**
 * The property the framework patches onto elements, components and directives to find their view
 * (see `MONKEY_PATCH_KEY_NAME` in `context_discovery.ts`). It is noise to an agent.
 */
const NG_CONTEXT_KEY = '__ngContext__';

/** State shared by every step of one {@link serializeValue} call. */
interface SerializeState {
  /** The objects being expanded around the current value, to detect cycles. */
  readonly ancestors: Set<object>;

  /** How many more objects, arrays, `Map`s, `Set`s and signals may be expanded. */
  readonly budget: {remaining: number};
}

/** Options of {@link serializeValue}. */
export interface SerializeOptions {
  /** Levels of nesting to expand. Defaults to 1; at most 5. */
  depth?: number;
}

/**
 * Converts any application value into something safe to hand to an AI agent.
 *
 * - Numbers, booleans, `null` and `undefined` are returned as they are. Bigints and symbols are
 *   returned as strings.
 * - Strings longer than 200 characters are cut, ending in `…(+N chars)`.
 * - Objects, arrays, `Map`s and `Set`s are expanded `depth` levels (default 1, at most 5; a
 *   `depth` which is not a finite number means the default). Deeper ones become a one-line
 *   preview such as `Array(12)`, `Map(3)` or `UserProfile {…}`. Each expanded collection lists at
 *   most 30 entries, ending in `…(+N more)`. A `Map` is expanded to `{map: [[key, value], …]}` and
 *   a `Set` to `{set: [value, …]}`. Only own enumerable properties are listed, without
 *   `__ngContext__`. Accessor properties are never called: they are reported as `'[getter]'`.
 * - One call expands at most 500 of those values, in depth first order. Once they are spent every
 *   further object, array, `Map`, `Set` or signal becomes its preview.
 * - `Date`, `RegExp` and `Error` become strings (an ISO date, `/re/g`, `Name: message`). Typed
 *   arrays, `ArrayBuffer`, `Promise`, `WeakMap` and `WeakSet` become a short description such as
 *   `Uint8Array(5)`. None of them are inspected any further.
 * - Signals are read and reported as `{signal: <kind>, value}`, or `{signal: <kind>, error}` when
 *   reading them throws. The signal itself does not count as a level of depth.
 * - Functions become `ƒ name()`. DOM nodes are returned as they are.
 * - Circular references become `'[circular]'`, and anything which throws while being read
 *   (proxies) becomes `'[error: <message>]'`. This function never throws.
 *
 * Values are not filtered: the result is live application data.
 */
export function serializeValue(value: unknown, options?: SerializeOptions): unknown {
  const state: SerializeState = {
    ancestors: new Set(),
    budget: {remaining: MAX_SERIALIZED_NODES},
  };
  return serialize(value, resolveDepth(options?.depth), state);
}

function resolveDepth(depth: unknown): number {
  if (typeof depth !== 'number' || !Number.isFinite(depth)) return DEFAULT_DEPTH;
  return Math.min(Math.max(Math.floor(depth), 0), MAX_DEPTH);
}

/** @param depth How many more levels of nesting to expand. */
function serialize(value: unknown, depth: number, state: SerializeState): unknown {
  try {
    switch (typeof value) {
      case 'string':
        return capString(value);
      case 'bigint':
        return `${value}n`;
      case 'symbol':
        return value.toString();
      case 'function':
        return isSignal(value)
          ? serializeSignal(value, depth, state)
          : `ƒ ${typeof value.name === 'string' && value.name ? value.name : 'anonymous'}()`;
      case 'object':
        return value === null ? null : serializeObject(value, depth, state);
      default:
        return value;
    }
  } catch (error) {
    return errorMarker(error);
  }
}

function serializeSignal(signalFn: () => unknown, depth: number, state: SerializeState): unknown {
  if (state.ancestors.has(signalFn)) return CIRCULAR;

  const node = (signalFn as unknown as {[SIGNAL]: ReactiveNode | undefined})[SIGNAL];
  const kind = node?.kind ?? 'signal';
  if (state.budget.remaining <= 0) return `${kind} {…}`;
  state.budget.remaining--;

  state.ancestors.add(signalFn);
  try {
    let current: unknown;
    try {
      current = signalFn();
    } catch (error) {
      return {signal: kind, error: capString(errorMessage(error))};
    }
    return {signal: kind, value: serialize(current, depth, state)};
  } finally {
    state.ancestors.delete(signalFn);
  }
}

function serializeObject(value: object, depth: number, state: SerializeState): unknown {
  if (typeof Node !== 'undefined' && value instanceof Node) return value;

  const description = describeLeafObject(value);
  if (description !== undefined) return description;

  if (state.ancestors.has(value)) return CIRCULAR;
  if (depth <= 0 || state.budget.remaining <= 0) return preview(value);
  state.budget.remaining--;

  state.ancestors.add(value);
  try {
    const childDepth = depth - 1;
    if (Array.isArray(value)) {
      return serializeArray(value, childDepth, state);
    }
    if (value instanceof Map) {
      return {map: serializeMapEntries(value, childDepth, state)};
    }
    if (value instanceof Set) {
      return {set: serializeSetValues(value, childDepth, state)};
    }
    return serializeProperties(value, childDepth, state);
  } finally {
    state.ancestors.delete(value);
  }
}

/**
 * Describes the built-in objects which are reported as a single string, since their properties
 * are not stored as own enumerable properties (or there are too many of them to look at).
 * Returns `undefined` for any other object.
 */
function describeLeafObject(value: object): string | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  }
  if (value instanceof RegExp) return capString(String(value));
  if (value instanceof Error) return capString(`${value.name}: ${value.message}`);
  if (ArrayBuffer.isView(value)) {
    const size =
      value instanceof DataView
        ? value.byteLength
        : (value as unknown as ArrayLike<unknown>).length;
    return `${constructorName(value)}(${size})`;
  }
  if (value instanceof ArrayBuffer) return `ArrayBuffer(${value.byteLength})`;

  // `instanceof`, not `Object.prototype.toString`: that would read a `Symbol.toStringTag` getter
  // which the application may have defined.
  if (value instanceof Promise) return 'Promise';
  if (value instanceof WeakMap) return 'WeakMap';
  if (value instanceof WeakSet) return 'WeakSet';
  return undefined;
}

function serializeArray(array: unknown[], depth: number, state: SerializeState): unknown[] {
  const count = Math.min(array.length, MAX_COLLECTION_ENTRIES);
  const items: unknown[] = [];
  for (let i = 0; i < count; i++) {
    items.push(serializeProperty(array, i, depth, state));
  }
  if (array.length > count) items.push(moreMarker(array.length - count));
  return items;
}

function serializeMapEntries(
  map: Map<unknown, unknown>,
  depth: number,
  state: SerializeState,
): unknown[] {
  const entries: unknown[] = [];
  for (const [key, entryValue] of map) {
    if (entries.length >= MAX_COLLECTION_ENTRIES) break;
    entries.push([serialize(key, depth, state), serialize(entryValue, depth, state)]);
  }
  if (map.size > entries.length) entries.push(moreMarker(map.size - entries.length));
  return entries;
}

function serializeSetValues(set: Set<unknown>, depth: number, state: SerializeState): unknown[] {
  const values: unknown[] = [];
  for (const item of set) {
    if (values.length >= MAX_COLLECTION_ENTRIES) break;
    values.push(serialize(item, depth, state));
  }
  if (set.size > values.length) values.push(moreMarker(set.size - values.length));
  return values;
}

/** Serializes the own enumerable properties of `object`. */
function serializeProperties(
  object: object,
  depth: number,
  state: SerializeState,
): Record<string, unknown> {
  const keys = Object.keys(object).filter((key) => key !== NG_CONTEXT_KEY);
  const entries: Array<[string, unknown]> = keys
    .slice(0, MAX_COLLECTION_ENTRIES)
    .map((key) => [key, serializeProperty(object, key, depth, state)]);
  if (keys.length > MAX_COLLECTION_ENTRIES) {
    entries.push(['…', `(+${keys.length - MAX_COLLECTION_ENTRIES} more)`]);
  }
  // `fromEntries` also defines a property named `__proto__` as an own property.
  return Object.fromEntries(entries);
}

/**
 * Serializes `owner[key]`. Accessor properties are not read, since that would run application
 * code; they are reported as `'[getter]'`.
 */
function serializeProperty(
  owner: object,
  key: string | number,
  depth: number,
  state: SerializeState,
): unknown {
  let propertyValue: unknown;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (descriptor !== undefined && !('value' in descriptor)) return '[getter]';
    propertyValue = (owner as Record<string | number, unknown>)[key];
  } catch (error) {
    return errorMarker(error);
  }
  return serialize(propertyValue, depth, state);
}

/** A one-line description of an object which is not expanded. */
function preview(value: object): string {
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (value instanceof Map) return `Map(${value.size})`;
  if (value instanceof Set) return `Set(${value.size})`;
  return `${constructorName(value)} {…}`;
}

/** The name of the class of `value`, without the underscore bundlers add to some classes. */
function constructorName(value: object): string {
  const name = Object.getPrototypeOf(value)?.constructor?.name;
  return typeof name === 'string' && name ? stripLeadingUnderscore(name) : 'Object';
}

/** Cuts `text` to 200 characters, ending it in `…(+N chars)` when it was longer. */
export function capString(text: string): string {
  return text.length > MAX_STRING_LENGTH
    ? `${text.slice(0, MAX_STRING_LENGTH)}…(+${text.length - MAX_STRING_LENGTH} chars)`
    : text;
}

function moreMarker(count: number): string {
  return `…(+${count} more)`;
}

function errorMarker(error: unknown): string {
  return `[error: ${capString(errorMessage(error))}]`;
}

function errorMessage(error: unknown): string {
  try {
    return String(error instanceof Error ? error.message : error);
  } catch {
    return 'unknown error';
  }
}
