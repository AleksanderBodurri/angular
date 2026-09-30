/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {ReactiveNode, SIGNAL, setActiveConsumer} from '../../../../primitives/signals';
import {EnvironmentInjector, R3Injector} from '../../../di/r3_injector';
import {getLContext} from '../../../render3/context_discovery';
import {isSignal} from '../../../render3/reactivity/api';
import {getComponent, getInjector} from '../../../render3/util/discovery_utils';
import {stripLeadingUnderscore} from './names';

/** Elements looked at to name the signals of components. */
const MAX_ELEMENTS = 5000;

/**
 * Names the signals held by fields of the components on the page and of the services which were
 * created, such as `CartStore.items`. A signal made by a helper such as `toSignal` is named after
 * the field holding the helper's signal, and so are the signals the helper writes behind it.
 *
 * Naming is best effort and reads no signal: it only looks at the fields holding them.
 */
export function nameSignals(): Map<ReactiveNode, string> {
  const names = new Map<ReactiveNode, string>();
  const environments = new Set<R3Injector>();
  const prevConsumer = setActiveConsumer(null);
  try {
    const seen = new Set<Element>();
    for (const root of Array.from(document.querySelectorAll('[ng-version]'))) {
      // A root without a view, left by an application which was destroyed without removing its
      // element, is skipped.
      if (!getLContext(root)?.lView) continue;
      for (const node of [root, ...Array.from(root.querySelectorAll('*'))]) {
        if (seen.has(node) || seen.size >= MAX_ELEMENTS) continue;
        seen.add(node);
        const component = getComponent<object>(node);
        if (component === null) continue;
        nameFields(component, stripLeadingUnderscore(component.constructor.name), names);
        let injector: unknown = getInjector(node).get(EnvironmentInjector, null);
        while (injector instanceof R3Injector && !environments.has(injector)) {
          environments.add(injector);
          injector = injector.parent;
        }
      }
    }
    for (const injector of environments) {
      const records = (injector as unknown as {records: Map<unknown, {value: unknown} | null>})
        .records;
      for (const record of records.values()) {
        const value = record?.value;
        if (typeof value !== 'object' || value === null) continue;
        const name = value.constructor?.name;
        if (!name || name === 'Object') continue;
        nameFields(value, stripLeadingUnderscore(name), names);
      }
    }
  } finally {
    setActiveConsumer(prevConsumer);
  }
  return names;
}

/** Names the signals held by the own fields of `instance`, and the signals behind them. */
function nameFields(instance: object, owner: string, names: Map<ReactiveNode, string>): void {
  for (const key of Object.keys(instance)) {
    const descriptor = Object.getOwnPropertyDescriptor(instance, key);
    if (descriptor === undefined || !('value' in descriptor) || !isSignal(descriptor.value)) {
      continue;
    }
    const node = (descriptor.value as unknown as {[SIGNAL]: ReactiveNode})[SIGNAL];
    const name = `${owner}.${key}`;
    if (!names.has(node)) names.set(node, name);
    // A field holding a computed made by a helper, such as `toSignal`, is written through the
    // signals behind it.
    if (node.kind === 'computed') {
      for (let link = node.producers; link !== undefined; link = link.nextProducer) {
        if (link.producer.kind === 'signal' && !names.has(link.producer)) {
          names.set(link.producer, name);
        }
      }
    }
  }
}

/** The name of `node` from `names`, or its `debugName`, or `(unnamed signal)`. */
export function nameOf(node: ReactiveNode, names: Map<ReactiveNode, string>): string {
  return names.get(node) ?? node.debugName ?? '(unnamed signal)';
}
