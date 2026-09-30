/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import type {ReactiveNode} from '../../../primitives/signals';
import type {NotificationSource} from '../../change_detection/scheduling/zoneless_scheduling';
import type {TNode} from '../interfaces/node';
import type {LView} from '../interfaces/view';

/**
 * Runtime events that the dev-mode event log records and that the profiler does not report.
 *
 * Every call site reads `activeEventLog` behind an `ngDevMode` guard, so a hook costs one null
 * check while no log is installed, and production bundles contain none of them.
 *
 * Hooks run synchronously inside signal writes, effects, listeners and change detection, so
 * implementations must not throw, must not read or write signals with an active consumer, and
 * must not trigger change detection (directly, or by scheduling timers, promises or animation
 * frames).
 */
export interface EventLogHooks {
  /**
   * The change detection scheduler was notified by `source`. Reported for every notification,
   * including those the scheduler then ignores (e.g. listeners in zone-based applications).
   */
  onNotify(source: NotificationSource): void;

  /**
   * zone.js became stable and the application is about to tick. `task` is the zone.js task
   * (`Zone.currentTask`) that was running, or `null` when there was none or zone.js is not loaded.
   */
  onZoneTick(task: {type?: string; source?: string} | null): void;

  /** `ApplicationRef.tick()` was called. Ticks started by the schedulers are not reported here. */
  onExplicitTick(): void;

  /**
   * A manual change detection run starts: `ChangeDetectorRef.detectChanges()` or, for each root
   * component, `ng.applyChanges`. Such runs can happen inside a tick and can nest; every start is
   * followed by `onManualDetectChangesEnd`, even when the run throws.
   */
  onManualDetectChangesStart(): void;

  /** The manual change detection run most recently reported as started ended. */
  onManualDetectChangesEnd(): void;

  /** A binding in `lView` was updated to a new value. */
  onBindingChanged(lView: LView): void;

  /** A signal read by the template of `lView` changed, so the view is marked for refresh. */
  onSignalMarkedView(lView: LView): void;

  /**
   * A listener that Angular registered in `lView` on the node `tNode` (from a template, host
   * bindings, a dynamic output binding or a form control directive) is about to run. `eventName`
   * is the DOM event or output name. `onListenerEnd` follows once it has run.
   */
  onListener(lView: LView, tNode: TNode, eventName: string): void;

  /** The listener most recently reported by `onListener` returned or threw. */
  onListenerEnd(): void;

  /**
   * The function of an `effect()`, or of one phase of an `afterRenderEffect()`, is about to run.
   * Its producers have been polled, so their versions are current while each producer link still
   * holds the version the effect read the last time. `firstRun` tells whether it ever ran before.
   */
  onEffectStart(effect: ReactiveNode, firstRun: boolean): void;

  /** The function of `effect` returned or threw. */
  onEffectEnd(effect: ReactiveNode): void;

  /** A component view was destroyed. `lView` is the view of the component. */
  onComponentDestroyed(lView: LView): void;

  /**
   * A `@defer` block declared in `hostLView` went from `fromState` to `toState`, as
   * `DeferBlockState` or `DeferBlockInternalState` numbers.
   */
  onDeferStateChange(hostLView: LView, fromState: number, toState: number): void;

  /** An update of a `@for` loop declared in `hostLView` created or destroyed rows. */
  onForRowsChanged(
    hostLView: LView,
    created: number,
    destroyed: number,
    recreatedAll: boolean,
    itemCount: number,
  ): void;

  /** `error` reached the application's `ErrorHandler`. */
  onError(error: unknown): void;

  /**
   * A pending task was added to `tasks` (a `PendingTasksInternal`). `first` tells whether the
   * application was stable until then.
   */
  onPendingTaskAdded(tasks: object, taskId: number, first: boolean): void;

  /** A pending task was removed. `last` tells whether `tasks` has no pending task left. */
  onPendingTaskRemoved(tasks: object, taskId: number, last: boolean): void;
}

/** The event log receiving runtime events, or `null` when none is installed. */
export let activeEventLog: EventLogHooks | null = null;

/** Sets the event log that receives runtime events; `null` stops reporting. */
export function setActiveEventLog(hooks: EventLogHooks | null): void {
  activeEventLog = hooks;
}
