/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {
  ReactiveHookFn,
  ReactiveNode,
  setActiveConsumer,
  setPostSignalSetFn,
  setPreSignalSetFn,
  SignalSetHookFn,
} from '../../../primitives/signals';
import {Profiler, ProfilerEvent} from '../../../primitives/devtools';
import {NotificationSource} from '../../change_detection/scheduling/zoneless_scheduling';
import {getComponentDef} from '../../render3/def_getters';
import {
  activeEventLog,
  EventLogHooks,
  setActiveEventLog,
} from '../../render3/debug/event_log_hooks';
import {TNode} from '../../render3/interfaces/node';
import {
  CONTEXT,
  DECLARATION_COMPONENT_VIEW,
  LView,
  TVIEW,
  TViewType,
} from '../../render3/interfaces/view';
import {setProfiler} from '../../render3/profiler';
import {getLView, isInCheckNoChangesMode} from '../../render3/state';
import {getNativeByTNode} from '../../render3/util/view_utils';
import {getClassName} from './shared/names';
import {getNotificationSourceName} from './shared/notification_source';
import {serializeValue} from './shared/serialize_value';
import {captureStack} from './shared/stack_frames';

/** The kinds of events the log records. */
export type EventType =
  | 'write'
  | 'effect'
  | 'listener'
  | 'cycle'
  | 'component'
  | 'defer'
  | 'for'
  | 'task_added'
  | 'task_removed'
  | 'error';

/** Every event type, in the order the tool documents them. */
export const EVENT_TYPES: readonly EventType[] = [
  'write',
  'effect',
  'listener',
  'cycle',
  'component',
  'defer',
  'for',
  'task_added',
  'task_removed',
  'error',
];

/** Entries kept unless a tool asks for another number. */
export const DEFAULT_CAPACITY = 100;

/** The smallest and largest number of entries the log can keep. */
export const MIN_CAPACITY = 10;
export const MAX_CAPACITY = 20000;

/** Where the capacity set for the tab is kept, so that a reload keeps it. */
const CAPACITY_STORAGE_KEY = 'ngEventLogCapacity';

/** Changed components listed per cycle. */
const MAX_CHANGED_COMPONENTS = 10;

/** Component classes with counts listed per cycle. */
const MAX_CYCLE_COMPONENTS = 20;

/** Causes kept for the next cycle; older ones are dropped. */
const MAX_PENDING_CAUSES = 50;

/** How many producers are looked at behind one changed dependency of an effect. */
const MAX_PRODUCERS_BEHIND = 50;

/**
 * Frames captured for a write: the few of Angular between the write and the code which made it,
 * then that code. Each frame costs about a microsecond at every write.
 */
const WRITE_STACK_FRAMES = 20;

/**
 * Writes which get a stack per window of time. A stack costs about as much as the rest of a write
 * event, and a loop making thousands of writes evicts most of them anyway, so after this many in
 * a window the writes are recorded without one.
 */
const STACK_BUDGET = 200;
const STACK_WINDOW_MS = 100;

/** Error messages are cut at this length. */
const MAX_LONG_STRING_LENGTH = 1000;

/** How deep values are serialized to tell whether two of them look the same. */
const COMPARISON_DEPTH = 3;

/** What every stored event has. */
export interface StoredEventBase {
  /** Increases by one per event for the lifetime of the page. */
  seq: number;

  /** `performance.now()` when the event happened, rounded to milliseconds. */
  atMs: number;

  /** The `seq` of the change detection cycle running when the event happened. */
  cycle?: number;
}

/** A signal, held weakly so that the log keeps nothing alive. */
export interface StoredSignal {
  ref: WeakRef<ReactiveNode>;
  kind: string;
  debugName: string | undefined;
}

/** An effect, held weakly, with what is known about it when it runs. */
export interface StoredEffect {
  ref: WeakRef<ReactiveNode>;
  kind: 'effect' | 'afterRenderEffect';

  /** For an `afterRenderEffect`: the phase the function belongs to. */
  phase?: 'earlyRead' | 'write' | 'mixedReadWrite' | 'read';

  /** The component whose view created the effect, when it is known. */
  owner: string | null;
  debugName: string | undefined;
}

export interface StoredSignalWrite extends StoredEventBase {
  type: 'write';
  signal: StoredSignal;

  /** The values before and after, serialized when the write happened. */
  from: unknown;
  to: unknown;

  /** Whether the new value passed the equality check of the signal. */
  changed: boolean;

  /** Present when the new value is another object which looks the same as the previous one. */
  looksEqual?: true;

  /** The `seq` of the effect run or listener the write was made in. */
  effect?: number;
  listener?: number;

  /** The stack of the write, or `null` when the budget of stacks for the window was spent. */
  stack: Error | null;
}

export interface StoredEffectRun extends StoredEventBase {
  type: 'effect';
  effect: StoredEffect;
  firstRun: boolean;

  /** The `seq` of the newest write behind each dependency which changed since the last run. */
  because: number[];

  /** The dependencies which changed without a write the log saw. */
  changedWithoutWrite: StoredSignal[];

  /** The `seq` of the listener or effect run this run happened inside, if any. */
  listener?: number;
  outer?: number;
}

export interface StoredListener extends StoredEventBase {
  type: 'listener';

  /** The DOM event or output name. */
  event: string;

  /** The component whose template or host declares the listener. */
  component: string | null;

  /** The tag name of the element the listener is on, in lower case. */
  host: string | null;
  effect?: number;
}

/** What asked for a change detection cycle. */
export type CycleCause =
  | {kind: 'signal'; seq?: number; component?: string}
  | {kind: 'listener'; seq: number}
  | {kind: 'zone'; task: string | null; source: string | null}
  | {kind: 'tick'}
  | {kind: 'detectChanges'}
  | {kind: 'notification'; source: string};

export interface CycleComponentCounts {
  component: string;
  checked: number;
  refreshed: number;
  changed: number;
}

export interface StoredCycle extends StoredEventBase {
  type: 'cycle';

  /** Whether a manual change detection run, rather than a tick, started the cycle. */
  manual: boolean;
  causes: CycleCause[];

  /** Filled in when the cycle ends; `durationMs` is `null` until then. */
  checked: number;
  refreshed: number;
  changed: number;
  changedComponents: string[];
  components: CycleComponentCounts[];
  moreComponents: number;
  durationMs: number | null;
}

export interface StoredComponent extends StoredEventBase {
  type: 'component';
  action: 'created' | 'destroyed';
  component: string;
}

export type DeferStateName = 'initial' | 'placeholder' | 'loading' | 'complete' | 'error';

export interface StoredDefer extends StoredEventBase {
  type: 'defer';
  component: string | null;
  from: DeferStateName;
  to: DeferStateName;
}

export interface StoredFor extends StoredEventBase {
  type: 'for';
  component: string | null;
  itemCount: number;
  created: number;
  destroyed: number;
  recreatedAll: boolean;
}

/** A pending task which has not been removed yet. */
export interface OpenPendingTask {
  /** The `seq` of its `task_added` event, which the buffer may have dropped since. */
  seq: number;

  /** `performance.now()` when it was added, rounded to milliseconds. */
  addedAt: number;

  /** The stack of the code which added it. */
  stack: Error;
}

export interface StoredTaskAdded extends StoredEventBase {
  type: 'task_added';
  task: number;

  /** A number telling the applications of the page apart. */
  app: number;

  /** Whether the application was stable until this task was added. */
  appWasStable: boolean;
  stack: Error;
}

export interface StoredTaskRemoved extends StoredEventBase {
  type: 'task_removed';
  task: number;
  app: number;

  /** The `seq` of the event which added the task, when the log saw it. */
  added: number | null;

  /** Whether removing this task made the application stable. */
  appStable: boolean;
}

export interface StoredError extends StoredEventBase {
  type: 'error';
  name: string;
  message: string;
  code?: number;
  stack: string | null;
  effect?: number;
  listener?: number;
}

export type StoredEvent =
  | StoredSignalWrite
  | StoredEffectRun
  | StoredListener
  | StoredCycle
  | StoredComponent
  | StoredDefer
  | StoredFor
  | StoredTaskAdded
  | StoredTaskRemoved
  | StoredError;

/** The state of the log, as the tools report it. */
export interface EventLogStatus {
  capacity: number;

  /** Events kept. */
  size: number;

  /** Older events discarded to keep the newest ones, since the page loaded. */
  dropped: number;

  /** The `seq` of the newest and oldest events kept, or `null` when none is. */
  latestSeq: number | null;
  oldestSeq: number | null;

  /** The error that stopped the log, if it failed. */
  internalError?: string;
}

/** A fixed-size buffer which keeps the newest entries. */
class RingBuffer<T> {
  private items: Array<T | undefined>;
  private start = 0;
  private count = 0;
  dropped = 0;

  constructor(public capacity: number) {
    this.items = new Array(capacity);
  }

  get size(): number {
    return this.count;
  }

  push(item: T): void {
    if (this.count < this.capacity) {
      this.items[(this.start + this.count) % this.capacity] = item;
      this.count++;
    } else {
      this.items[this.start] = item;
      this.start = (this.start + 1) % this.capacity;
      this.dropped++;
    }
  }

  /** The entries, oldest first. */
  toArray(): T[] {
    const result: T[] = [];
    for (let i = 0; i < this.count; i++) {
      result.push(this.items[(this.start + i) % this.capacity]!);
    }
    return result;
  }

  first(): T | undefined {
    return this.count > 0 ? this.items[this.start] : undefined;
  }

  last(): T | undefined {
    return this.count > 0 ? this.items[(this.start + this.count - 1) % this.capacity] : undefined;
  }

  /** Changes the capacity. Growing keeps every entry; shrinking drops the oldest ones. */
  resize(capacity: number): void {
    const kept = this.toArray();
    const drop = Math.max(0, kept.length - capacity);
    this.dropped += drop;
    this.items = new Array(capacity);
    for (let i = drop; i < kept.length; i++) {
      this.items[i - drop] = kept[i];
    }
    this.start = 0;
    this.count = kept.length - drop;
    this.capacity = capacity;
  }
}

/** Counts of one component class in the running cycle. */
interface CycleClassRecord extends CycleComponentCounts {
  readonly type: Function;
}

/** The cycle being recorded. It holds no component or element strongly. */
interface RunningCycle {
  readonly entry: StoredCycle;

  /** `performance.now()` when the cycle started. */
  readonly start: number;

  /** The classes with counts in this cycle. */
  readonly classes: Map<Function, CycleClassRecord>;
  moreClasses: number;

  /** Components with a changed binding, each counted once. */
  readonly changedComponents: WeakSet<object>;

  /** Components in their creation pass: the `ComponentEnd` that ends it is not a check. */
  readonly creating: WeakSet<object>;

  /** `ComponentStart` events not matched by a `ComponentEnd` yet. */
  componentDepth: number;
}

/**
 * Records what the application does at runtime into a ring buffer: signal writes, effect runs,
 * listeners, change detection cycles, component lifetimes, control flow, pending tasks and errors,
 * in one sequence.
 *
 * The log is installed in dev mode when the platform is created and never stops. Every entry
 * point catches its own errors: a failure stops the log and is reported in its status instead of
 * reaching Angular. Values are read with no active consumer, so that recording adds no dependency
 * to anything, and nothing is held strongly: entries keep names and serialized values, and weak
 * references for naming signals and effects later.
 */
export class EventLog implements EventLogHooks {
  private buffer: RingBuffer<StoredEvent>;
  private enabled = true;
  private internalError: string | undefined = undefined;

  /** The signals and effects seen, described once each. */
  private readonly signals = new WeakMap<ReactiveNode, StoredSignal>();
  private readonly effects = new WeakMap<ReactiveNode, StoredEffect>();

  /** The `seq` of the last write of each signal, to tell why an effect ran. */
  private readonly lastWriteSeq = new WeakMap<ReactiveNode, number>();

  /** The `seq` of the last run of each effect. */
  private readonly lastRunSeq = new WeakMap<ReactiveNode, number>();

  /** The write which is notifying its consumers, for the causes of the next cycle. */
  private currentWrite: StoredSignalWrite | null = null;

  /** The window of time in which `stacksInWindow` write stacks were captured. */
  private stackWindowStart = 0;
  private stacksInWindow = 0;

  /** The effect runs and listeners in progress, innermost last. */
  private readonly runningEffects: Array<{seq: number; node: ReactiveNode}> = [];
  private readonly runningListeners: number[] = [];

  /** Change detection cycles. */
  private cycle: RunningCycle | null = null;
  private runDepth = 0;
  private pendingCauses: CycleCause[] = [];
  private echo: NotificationSource | null = null;
  private dispatching = false;

  /** Pending tasks, by the `PendingTasksInternal` of each application. */
  private readonly apps = new WeakMap<object, number>();
  private nextApp = 1;
  /**
   * The pending tasks of each `PendingTasksInternal`, kept until they are removed however many
   * events the buffer drops, so that a task which never completes can always be found.
   */
  private readonly openTasks = new WeakMap<object, Map<number, OpenPendingTask>>();

  /** When each `PendingTasksInternal` last went from no pending task to one. */
  private readonly unstableSince = new WeakMap<object, number>();

  private prevPreSet: SignalSetHookFn | null = null;
  private prevPostSet: ReactiveHookFn | null = null;
  private removeProfiler: (() => void) | null = null;

  constructor(capacity: number) {
    this.buffer = new RingBuffer(capacity);
  }

  attach(): void {
    this.prevPreSet = setPreSignalSetFn(this.onPreSet);
    this.prevPostSet = setPostSignalSetFn(this.onPostSet);
    this.removeProfiler = setProfiler(this.onProfilerEvent);
    setActiveEventLog(this);
  }

  detach(): void {
    setPreSignalSetFn(this.prevPreSet);
    setPostSignalSetFn(this.prevPostSet);
    this.prevPreSet = this.prevPostSet = null;
    this.removeProfiler?.();
    this.removeProfiler = null;
    if (activeEventLog === this) setActiveEventLog(null);
  }

  /** Stops the log after an error in it: errors must never reach Angular. */
  private fail(error: unknown): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.internalError = describeError(error);
    // Removing a profiler while the profiler dispatches an event makes it skip the next profiler
    // for that event. From inside an event, the next public call detaches instead.
    if (!this.dispatching) this.detach();
  }

  status(): EventLogStatus {
    if (!this.enabled) this.detach();
    const status: EventLogStatus = {
      capacity: this.buffer.capacity,
      size: this.buffer.size,
      dropped: this.buffer.dropped,
      latestSeq: this.buffer.last()?.seq ?? null,
      oldestSeq: this.buffer.first()?.seq ?? null,
    };
    if (this.internalError !== undefined) status.internalError = this.internalError;
    return status;
  }

  /** The events kept, oldest first. */
  read(): StoredEvent[] {
    if (!this.enabled) this.detach();
    return this.buffer.toArray();
  }

  /** The `seq` of the last event recorded on the page, kept or not. */
  get latestSeq(): number {
    return nextSeq - 1;
  }

  resize(capacity: number): void {
    this.buffer.resize(capacity);
  }

  // Signals -------------------------------------------------------------------------------------

  private readonly onPreSet: SignalSetHookFn = (node, newValue, changed) => {
    this.prevPreSet?.(node, newValue, changed);
    if (!this.enabled) return;
    const prevConsumer = setActiveConsumer(null);
    try {
      this.currentWrite = null;
      const base = this.base();
      const entry: StoredSignalWrite = {
        ...base,
        type: 'write',
        signal: this.describeSignal(node),
        from: serializeValue(node.value),
        to: serializeValue(newValue),
        changed,
        stack: this.captureWriteStack(base.atMs),
      };
      if (changed && looksEqual(node.value, newValue, entry.from, entry.to)) {
        entry.looksEqual = true;
      }
      this.linkContext(entry);
      this.push(entry);
      if (changed) {
        this.currentWrite = entry;
        this.lastWriteSeq.set(node, entry.seq);
      }
    } catch (error) {
      this.fail(error);
    } finally {
      setActiveConsumer(prevConsumer);
    }
  };

  private readonly onPostSet: ReactiveHookFn = (node) => {
    this.prevPostSet?.(node);
    // The consumers of the write have been notified: it no longer causes anything.
    this.currentWrite = null;
  };

  /** The stack of a write, unless the budget of stacks for the current window is spent. */
  private captureWriteStack(atMs: number): Error | null {
    if (atMs - this.stackWindowStart >= STACK_WINDOW_MS) {
      this.stackWindowStart = atMs;
      this.stacksInWindow = 0;
    }
    if (this.stacksInWindow >= STACK_BUDGET) return null;
    this.stacksInWindow++;
    return captureStack(WRITE_STACK_FRAMES);
  }

  private describeSignal(node: ReactiveNode): StoredSignal {
    let stored = this.signals.get(node);
    if (stored === undefined) {
      stored = {ref: new WeakRef(node), kind: node.kind, debugName: node.debugName};
      this.signals.set(node, stored);
    }
    return stored;
  }

  /** Links an event to the effect run and listener it happened in. */
  private linkContext(entry: {effect?: number; listener?: number}): void {
    const effect = this.runningEffects[this.runningEffects.length - 1];
    if (effect !== undefined) entry.effect = effect.seq;
    const listener = this.runningListeners[this.runningListeners.length - 1];
    if (listener !== undefined) entry.listener = listener;
  }

  // Effects -------------------------------------------------------------------------------------

  onEffectStart(node: ReactiveNode, firstRun: boolean): void {
    if (!this.enabled) return;
    const prevConsumer = setActiveConsumer(null);
    try {
      const because: number[] = [];
      const changedWithoutWrite: StoredSignal[] = [];
      if (!firstRun) {
        const after = this.lastRunSeq.get(node) ?? 0;
        // When the function of an effect starts, Angular has polled its producers, so their
        // versions are current, while each link still holds the version the effect read the last
        // time.
        for (let link = node.producers; link !== undefined; link = link.nextProducer) {
          if (link.producer.version === link.lastReadVersion) continue;
          const seq = this.findWriteBehind(link.producer, after);
          if (seq === null) {
            changedWithoutWrite.push(this.describeSignal(link.producer));
          } else if (!because.includes(seq)) {
            because.push(seq);
          }
        }
      }
      const entry: StoredEffectRun = {
        ...this.base(),
        type: 'effect',
        effect: this.describeEffect(node),
        firstRun,
        because,
        changedWithoutWrite,
      };
      const outer = this.runningEffects[this.runningEffects.length - 1];
      if (outer !== undefined) entry.outer = outer.seq;
      const listener = this.runningListeners[this.runningListeners.length - 1];
      if (listener !== undefined) entry.listener = listener;
      this.push(entry);
      this.lastRunSeq.set(node, entry.seq);
      this.runningEffects.push({seq: entry.seq, node});
    } catch (error) {
      this.fail(error);
    } finally {
      setActiveConsumer(prevConsumer);
    }
  }

  onEffectEnd(node: ReactiveNode): void {
    if (this.runningEffects[this.runningEffects.length - 1]?.node === node) {
      this.runningEffects.pop();
    }
  }

  /** The `seq` of the newest write after `after` behind `node`, through computeds, or `null`. */
  private findWriteBehind(node: ReactiveNode, after: number): number | null {
    let best: number | null = null;
    const seen = new Set<ReactiveNode>([node]);
    const queue = [node];
    for (let i = 0; i < queue.length; i++) {
      const seq = this.lastWriteSeq.get(queue[i]);
      if (seq !== undefined && seq > after && (best === null || seq > best)) best = seq;
      if (seen.size >= MAX_PRODUCERS_BEHIND) continue;
      for (let link = queue[i].producers; link !== undefined; link = link.nextProducer) {
        if (!seen.has(link.producer)) {
          seen.add(link.producer);
          queue.push(link.producer);
        }
      }
    }
    return best;
  }

  private describeEffect(node: ReactiveNode): StoredEffect {
    let stored = this.effects.get(node);
    if (stored === undefined) {
      const afterRender = node.kind === 'afterRenderEffectPhase';
      const view = afterRender
        ? (node as {sequence?: {view?: LView}}).sequence?.view
        : (node as {view?: LView}).view;
      stored = {
        ref: new WeakRef(node),
        kind: afterRender ? 'afterRenderEffect' : 'effect',
        owner: view === undefined ? null : componentNameOf(view[CONTEXT]),
        debugName: node.debugName || undefined,
      };
      if (afterRender) {
        stored.phase = PHASE_NAMES[(node as {phase?: number}).phase ?? -1];
      }
      this.effects.set(node, stored);
    }
    return stored;
  }

  // Listeners -----------------------------------------------------------------------------------

  onListener(lView: LView, tNode: TNode, eventName: string): void {
    if (!this.enabled) return;
    try {
      const native = getNativeByTNode(tNode, lView) as {nodeType?: number; tagName?: string};
      const entry: StoredListener = {
        ...this.base(),
        type: 'listener',
        event: eventName,
        component: componentNameOf(lView[DECLARATION_COMPONENT_VIEW][CONTEXT]),
        host:
          native != null && native.nodeType === 1 /* Node.ELEMENT_NODE */
            ? String(native.tagName).toLowerCase()
            : null,
      };
      const effect = this.runningEffects[this.runningEffects.length - 1];
      if (effect !== undefined) entry.effect = effect.seq;
      this.push(entry);
      this.runningListeners.push(entry.seq);
      if (!this.isTickRunning()) {
        this.echo = NotificationSource.Listener;
        this.addCause({kind: 'listener', seq: entry.seq});
      }
    } catch (error) {
      this.fail(error);
    }
  }

  onListenerEnd(): void {
    this.runningListeners.pop();
  }

  // Change detection ----------------------------------------------------------------------------

  onNotify(source: NotificationSource): void {
    if (!this.enabled) return;
    try {
      // Removing a pending task schedules a tick but never marks a view for refresh. As a cause it
      // would stay in the list until the next tick that does something, and blame that one.
      if (source === NotificationSource.PendingTaskRemoved) return;

      const echo = this.echo;
      this.echo = null;
      // The notification for a signal or listener cause that was just reported.
      if (source === echo) return;

      // A notification sent while a write notifies its consumers comes from that write.
      const write = this.currentWrite;
      if (write !== null) {
        this.addCause({kind: 'signal', seq: write.seq});
        return;
      }
      this.addCause({kind: 'notification', source: getNotificationSourceName(source)});
    } catch (error) {
      this.fail(error);
    }
  }

  onZoneTick(task: {type?: string; source?: string} | null): void {
    if (!this.enabled) return;
    try {
      this.addCause({
        kind: 'zone',
        task: typeof task?.type === 'string' ? task.type : null,
        source: typeof task?.source === 'string' ? task.source : null,
      });
    } catch (error) {
      this.fail(error);
    }
  }

  onExplicitTick(): void {
    if (!this.enabled) return;
    try {
      // While a cycle runs, this is not a cause of a later cycle: a tick called during a manual run
      // runs as part of that run, and one called during a tick does not run at all (NG0101).
      if (this.cycle === null) this.addCause({kind: 'tick'});
    } catch (error) {
      this.fail(error);
    }
  }

  onManualDetectChangesStart(): void {
    if (!this.enabled) return;
    try {
      this.runStarted(true);
    } catch (error) {
      this.fail(error);
    }
  }

  onManualDetectChangesEnd(): void {
    if (!this.enabled) return;
    try {
      this.runEnded();
    } catch (error) {
      this.fail(error);
    }
  }

  onBindingChanged(lView: LView): void {
    if (!this.enabled) return;
    try {
      const cycle = this.cycle;
      if (cycle === null) return;

      const component: unknown = lView[DECLARATION_COMPONENT_VIEW][CONTEXT];
      // A root view, which holds the host bindings of a root component, has no component.
      if (!isObject(component) || cycle.changedComponents.has(component)) return;

      const record = this.getClassRecord(cycle, component);
      if (record === null) return;

      cycle.changedComponents.add(component);
      cycle.entry.changed++;
      record.changed++;
      if (cycle.entry.changedComponents.length < MAX_CHANGED_COMPONENTS) {
        cycle.entry.changedComponents.push(record.component);
      }
    } catch (error) {
      this.fail(error);
    }
  }

  onSignalMarkedView(lView: LView): void {
    if (!this.enabled) return;
    try {
      if (this.isTickRunning()) return;
      const component = componentNameOf(lView[DECLARATION_COMPONENT_VIEW][CONTEXT]);
      if (component === null) return;

      this.echo = NotificationSource.MarkAncestorsForTraversal;
      const cause: CycleCause = {kind: 'signal', component};
      if (this.currentWrite !== null) cause.seq = this.currentWrite.seq;
      this.addCause(cause);
    } catch (error) {
      this.fail(error);
    }
  }

  private readonly onProfilerEvent: Profiler = (event, instance) => {
    if (!this.enabled) return;
    this.dispatching = true;
    try {
      // The dev-mode check-no-changes pass visits the same views again; it is not a cycle.
      if (!isInCheckNoChangesMode()) this.recordProfilerEvent(event, instance);
    } catch (error) {
      this.fail(error);
    } finally {
      this.dispatching = false;
    }
  };

  private recordProfilerEvent(event: ProfilerEvent, instance: {} | null | undefined): void {
    switch (event) {
      case ProfilerEvent.ChangeDetectionStart:
        this.runStarted(false);
        return;
      case ProfilerEvent.ChangeDetectionEnd:
        this.runEnded();
        return;
      case ProfilerEvent.TemplateCreateStart: {
        const component = getComponentOfRunningTemplate(instance);
        if (component !== null) {
          this.cycle?.creating.add(component);
          const name = componentNameOf(component);
          if (name !== null) {
            this.push({...this.base(), type: 'component', action: 'created', component: name});
          }
        }
        return;
      }
    }

    const cycle = this.cycle;
    if (cycle === null) return;

    switch (event) {
      case ProfilerEvent.ComponentStart:
        cycle.componentDepth++;
        break;
      case ProfilerEvent.ComponentEnd:
        if (cycle.componentDepth > 0) cycle.componentDepth--;
        // The end of a component's creation pass is not a check of the component.
        if (isObject(instance) && !cycle.creating.delete(instance)) {
          this.countComponent(cycle, instance, /* checked */ true, /* refreshed */ false);
        }
        break;
      case ProfilerEvent.TemplateUpdateStart: {
        const component = getComponentOfRunningTemplate(instance);
        if (component !== null) {
          // Outside a `ComponentStart`/`ComponentEnd` pair, this is the component a manual run
          // started from: the run checks it too.
          const checked = cycle.componentDepth === 0;
          this.countComponent(cycle, component, checked, /* refreshed */ true);
        }
        break;
      }
    }
  }

  /** Whether the running cycle, if any, is a tick. */
  private isTickRunning(): boolean {
    return this.cycle !== null && !this.cycle.entry.manual;
  }

  /**
   * Adds a cause for the next tick.
   *
   * Causes reported while a tick runs are not recorded: the tick itself produces them (for example
   * by attaching views), or picks up the change before it ends. Causes reported during a manual
   * run outside a tick are kept, since they schedule the tick that follows the run.
   */
  private addCause(cause: CycleCause): void {
    if (this.isTickRunning()) return;
    if (this.pendingCauses.some((pending) => isSameCause(pending, cause))) return;

    this.pendingCauses.push(cause);
    if (this.pendingCauses.length > MAX_PENDING_CAUSES) {
      this.pendingCauses.shift();
    }
  }

  /** A tick or manual run started: the outermost one starts a cycle, nested ones join it. */
  private runStarted(manual: boolean): void {
    if (this.runDepth++ > 0) return;

    let causes: CycleCause[];
    if (manual) {
      // Causes reported before the run stay for the tick they scheduled.
      causes = [{kind: 'detectChanges'}];
    } else {
      causes = this.pendingCauses;
      this.pendingCauses = [];
    }
    const entry: StoredCycle = {
      ...this.base(),
      type: 'cycle',
      manual,
      causes,
      checked: 0,
      refreshed: 0,
      changed: 0,
      changedComponents: [],
      components: [],
      moreComponents: 0,
      durationMs: null,
    };
    this.push(entry);
    this.cycle = {
      entry,
      start: performance.now(),
      classes: new Map(),
      moreClasses: 0,
      changedComponents: new WeakSet(),
      creating: new WeakSet(),
      componentDepth: 0,
    };
  }

  private runEnded(): void {
    // The end of a run that started before the log did.
    if (this.runDepth === 0) return;

    if (--this.runDepth === 0) this.endCycle();
  }

  private endCycle(): void {
    const cycle = this.cycle!;
    this.cycle = null;
    const entry = cycle.entry;
    entry.durationMs = roundMs(performance.now() - cycle.start);
    for (const {component, checked, refreshed, changed} of cycle.classes.values()) {
      entry.components.push({component, checked, refreshed, changed});
    }
    entry.moreComponents = cycle.moreClasses;
  }

  private countComponent(
    cycle: RunningCycle,
    component: object,
    checked: boolean,
    refreshed: boolean,
  ): void {
    const record = this.getClassRecord(cycle, component);
    if (checked) {
      cycle.entry.checked++;
      if (record !== null) record.checked++;
    }
    if (refreshed) {
      cycle.entry.refreshed++;
      if (record !== null) record.refreshed++;
    }
  }

  /** The counts of the class of `component` in `cycle`, or `null` once too many are listed. */
  private getClassRecord(cycle: RunningCycle, component: object): CycleClassRecord | null {
    const type = classOf(component);
    if (type === null) return null;
    let record = cycle.classes.get(type);
    if (record === undefined) {
      const def = getComponentDef<unknown>(type);
      if (def === null) return null;
      if (cycle.classes.size >= MAX_CYCLE_COMPONENTS) {
        cycle.moreClasses++;
        return null;
      }
      record = {type, component: getClassName(def), checked: 0, refreshed: 0, changed: 0};
      cycle.classes.set(type, record);
    }
    return record;
  }

  // Components and control flow -----------------------------------------------------------------

  onComponentDestroyed(lView: LView): void {
    if (!this.enabled) return;
    try {
      if (lView[TVIEW].type !== TViewType.Component) return;
      const name = componentNameOf(lView[CONTEXT]);
      if (name === null) return;
      this.push({...this.base(), type: 'component', action: 'destroyed', component: name});
    } catch (error) {
      this.fail(error);
    }
  }

  onDeferStateChange(hostLView: LView, fromState: number, toState: number): void {
    if (!this.enabled) return;
    try {
      this.push({
        ...this.base(),
        type: 'defer',
        component: componentNameOf(hostLView[DECLARATION_COMPONENT_VIEW][CONTEXT]),
        from: deferStateName(fromState),
        to: deferStateName(toState),
      });
    } catch (error) {
      this.fail(error);
    }
  }

  onForRowsChanged(
    hostLView: LView,
    created: number,
    destroyed: number,
    recreatedAll: boolean,
    itemCount: number,
  ): void {
    if (!this.enabled) return;
    try {
      this.push({
        ...this.base(),
        type: 'for',
        component: componentNameOf(hostLView[DECLARATION_COMPONENT_VIEW][CONTEXT]),
        itemCount,
        created,
        destroyed,
        recreatedAll,
      });
    } catch (error) {
      this.fail(error);
    }
  }

  // Errors --------------------------------------------------------------------------------------

  onError(error: unknown): void {
    if (!this.enabled) return;
    try {
      const entry: StoredError = {
        ...this.base(),
        type: 'error',
        name: 'Error',
        message: '',
        stack: null,
      };
      if (error instanceof Error) {
        entry.name = error.name;
        entry.message = cutString(error.message, MAX_LONG_STRING_LENGTH);
        // Errors are rare, so formatting the stack now is affordable.
        if (typeof error.stack === 'string') entry.stack = error.stack;
        const code = (error as {code?: unknown}).code;
        if (typeof code === 'number') entry.code = code;
      } else {
        entry.message = cutString(describeError(error), MAX_LONG_STRING_LENGTH);
      }
      this.linkContext(entry);
      this.push(entry);
    } catch (failure) {
      this.fail(failure);
    }
  }

  // Pending tasks -------------------------------------------------------------------------------

  onPendingTaskAdded(tasks: object, taskId: number, first: boolean): void {
    if (!this.enabled) return;
    try {
      const entry: StoredTaskAdded = {
        ...this.base(),
        type: 'task_added',
        task: taskId,
        app: this.appNumber(tasks),
        appWasStable: first,
        stack: captureStack(),
      };
      this.push(entry);
      let open = this.openTasks.get(tasks);
      if (open === undefined) {
        open = new Map();
        this.openTasks.set(tasks, open);
      }
      open.set(taskId, {seq: entry.seq, addedAt: entry.atMs, stack: entry.stack});
      if (first) this.unstableSince.set(tasks, entry.atMs);
    } catch (error) {
      this.fail(error);
    }
  }

  onPendingTaskRemoved(tasks: object, taskId: number, last: boolean): void {
    if (!this.enabled) return;
    try {
      const open = this.openTasks.get(tasks);
      const task = open?.get(taskId);
      // A task added before the log started, or removed twice, has nothing to pair with.
      if (task === undefined) return;
      open!.delete(taskId);
      const appStable = last && this.unstableSince.delete(tasks);
      this.push({
        ...this.base(),
        type: 'task_removed',
        task: taskId,
        app: this.appNumber(tasks),
        added: task.seq,
        appStable,
      });
    } catch (error) {
      this.fail(error);
    }
  }

  /** The pending tasks of `tasks` (a `PendingTasksInternal`), oldest first. */
  pendingTasksOf(tasks: object): OpenPendingTask[] {
    return [...(this.openTasks.get(tasks)?.values() ?? [])].sort((a, b) => a.addedAt - b.addedAt);
  }

  /** `performance.now()` when `tasks` last went from no pending task to one, while unstable. */
  unstableSinceOf(tasks: object): number | undefined {
    return this.unstableSince.get(tasks);
  }

  private appNumber(tasks: object): number {
    let app = this.apps.get(tasks);
    if (app === undefined) {
      app = this.nextApp++;
      this.apps.set(tasks, app);
    }
    return app;
  }

  // Storage -------------------------------------------------------------------------------------

  private base(): StoredEventBase {
    const base: StoredEventBase = {seq: nextSeq++, atMs: Math.round(performance.now())};
    if (this.cycle !== null) base.cycle = this.cycle.entry.seq;
    return base;
  }

  private push(entry: StoredEvent): void {
    this.buffer.push(entry);
  }
}

const PHASE_NAMES: Record<number, StoredEffect['phase']> = {
  0: 'earlyRead',
  1: 'write',
  2: 'mixedReadWrite',
  3: 'read',
};

/** The page's log, once installed. */
let log: EventLog | null = null;

/**
 * The `seq` of the next event. It belongs to the page, not to a log, so that it never restarts:
 * a `seq` noted before the log was replaced still marks a point in time.
 */
let nextSeq = 1;

/**
 * Installs the event log, unless it is installed already or the code runs on the server. Called in
 * dev mode when the platform is created, where the AI tools are registered too.
 */
export function installEventLog(): void {
  if (log !== null) return;
  // A module-level log would mix the requests of a server.
  if (typeof ngServerMode !== 'undefined' && ngServerMode) return;
  if (typeof performance === 'undefined' || typeof WeakRef === 'undefined') return;
  try {
    log = new EventLog(readStoredCapacity() ?? DEFAULT_CAPACITY);
    log.attach();
  } catch {
    // Installing must never break the application.
    log = null;
  }
}

/** The page's log, or `null` when none is installed (on the server, or before Angular starts). */
export function getEventLog(): EventLog | null {
  return log;
}

/**
 * Removes the log, so that the next `installEventLog` creates a new one, as a reload would. For
 * tests only.
 */
export function uninstallEventLog(): void {
  log?.detach();
  log = null;
}

/**
 * Sets how many events the log keeps. Growing keeps every event; shrinking drops the oldest ones.
 * The capacity is kept for the tab in `sessionStorage`, so that a reload keeps it.
 *
 * @returns Whether the capacity was stored for the next reload.
 */
export function setEventLogCapacity(capacity: number): boolean {
  log?.resize(capacity);
  return storeCapacity(capacity);
}

/** Checks that `capacity` is an integer in the supported range. */
export function isValidCapacity(capacity: unknown): capacity is number {
  return (
    typeof capacity === 'number' &&
    Number.isInteger(capacity) &&
    capacity >= MIN_CAPACITY &&
    capacity <= MAX_CAPACITY
  );
}

/** The capacity stored for the tab, if there is a valid one. */
function readStoredCapacity(): number | null {
  try {
    const stored = sessionStorage.getItem(CAPACITY_STORAGE_KEY);
    if (stored === null) return null;
    const capacity = Number(stored);
    return isValidCapacity(capacity) ? capacity : null;
  } catch {
    // Storage can be missing, disabled or full.
    return null;
  }
}

function storeCapacity(capacity: number): boolean {
  try {
    if (capacity === DEFAULT_CAPACITY) {
      sessionStorage.removeItem(CAPACITY_STORAGE_KEY);
    } else {
      sessionStorage.setItem(CAPACITY_STORAGE_KEY, String(capacity));
    }
    return true;
  } catch {
    return false;
  }
}

/** The class name of a component instance, or `null` for anything else. */
function componentNameOf(instance: unknown): string | null {
  if (!isObject(instance)) return null;
  const type = classOf(instance);
  const def = type === null ? null : getComponentDef<unknown>(type);
  return def === null ? null : getClassName(def);
}

/** The class of `instance`, or `null` for an object without one, such as a null-prototype one. */
function classOf(instance: object): Function | null {
  const type: unknown = (instance as {constructor?: unknown}).constructor;
  return typeof type === 'function' ? type : null;
}

/**
 * The component whose own template the profiler reports as running, or `null` for the template of
 * an embedded view.
 *
 * The profiler reports a template from inside the view that runs it, so the current `LView` tells
 * which it is, without reading anything from `context`: for an embedded view, that is application
 * data.
 */
function getComponentOfRunningTemplate(context: {} | null | undefined): object | null {
  const lView = getLView();
  if (lView == null || lView[TVIEW].type !== TViewType.Component) return null;

  const component: unknown = lView[CONTEXT];
  return isObject(component) && component === context ? component : null;
}

/**
 * Names a `DeferBlockState` or `DeferBlockInternalState`. The numbers are repeated here rather than
 * imported, so that this module pulls nothing of `@defer` into the import graph.
 */
function deferStateName(state: number): DeferStateName {
  switch (state) {
    case 0: // DeferBlockState.Placeholder
      return 'placeholder';
    case 1: // DeferBlockState.Loading
      return 'loading';
    case 2: // DeferBlockState.Complete
      return 'complete';
    case 3: // DeferBlockState.Error
      return 'error';
    default: // DeferBlockInternalState.Initial
      return 'initial';
  }
}

function isSameCause(a: CycleCause, b: CycleCause): boolean {
  switch (a.kind) {
    case 'signal':
      return (
        b.kind === 'signal' &&
        (a.seq !== undefined || b.seq !== undefined ? a.seq === b.seq : a.component === b.component)
      );
    case 'listener':
      return b.kind === 'listener' && a.seq === b.seq;
    case 'zone':
      return b.kind === 'zone' && a.task === b.task && a.source === b.source;
    case 'notification':
      return b.kind === 'notification' && a.source === b.source;
    default:
      return a.kind === b.kind;
  }
}

function isObject(value: unknown): value is object {
  return value !== null && typeof value === 'object';
}

/**
 * Whether `next` is another object than `previous` which serializes the same way. Most writes
 * already differ in `shownPrevious` and `shownNext`, the forms stored for the write, so the values
 * are only serialized deeper when those match.
 */
function looksEqual(
  previous: unknown,
  next: unknown,
  shownPrevious: unknown,
  shownNext: unknown,
): boolean {
  if (Object.is(previous, next) || !isObject(previous) || !isObject(next)) return false;
  if (JSON.stringify(shownPrevious) !== JSON.stringify(shownNext)) return false;
  const options = {depth: COMPARISON_DEPTH};
  return (
    JSON.stringify(serializeValue(previous, options)) ===
    JSON.stringify(serializeValue(next, options))
  );
}

function roundMs(ms: number): number {
  return Math.round(ms * 100) / 100;
}

function cutString(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…(+${text.length - max} chars)` : text;
}

function describeError(error: unknown): string {
  try {
    return String(error instanceof Error ? error.message : error);
  } catch {
    // `String()` calls the thrown value's own `toString()`, which can throw too.
    return 'Unknown error';
  }
}
