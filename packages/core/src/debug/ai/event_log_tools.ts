/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {ReactiveNode} from '../../../primitives/signals';
import {ToolDefinition} from '../../../primitives/devtools';
import {
  CycleCause,
  CycleComponentCounts,
  DEFAULT_CAPACITY,
  DeferStateName,
  EVENT_TYPES,
  EventLogStatus,
  EventType,
  getEventLog,
  isValidCapacity,
  MAX_CAPACITY,
  MIN_CAPACITY,
  setEventLogCapacity,
  StoredEffect,
  StoredEvent,
  StoredSignal,
} from './event_log';
import {stripLeadingUnderscore} from './shared/names';
import {classifyPendingTask, PendingTaskSource} from './shared/pending_task_source';
import {capString} from './shared/serialize_value';
import {nameOf, nameSignals} from './shared/signal_names';
import {RawStackFrame, readStack, resolveStack} from './shared/stack_frames';

/** Input to {@link eventsTool}. */
export interface EventsInput {
  types?: EventType[];
  match?: string;
  since?: number;
  limit?: number;
  causesOf?: number;
  details?: number[];
}

/** Input to {@link eventBufferSizeTool}. */
export interface EventBufferSizeInput {
  size: number;
}

/** An effect, described in full. */
export interface EffectDescription {
  kind: 'effect' | 'afterRenderEffect';
  phase?: 'earlyRead' | 'write' | 'mixedReadWrite' | 'read';

  /** The source of the effect function, or `null` once the effect was collected. */
  source: string | null;
  owner?: string;
  debugName?: string;
}

/** What every event in full has, as `details` returns it. */
export interface EventDetailsBase {
  seq: number;

  /** Milliseconds since the page started. */
  atMs: number;

  /** The `seq` of the change detection cycle the event happened in. */
  cycle?: number;
}

export interface WriteDetails extends EventDetailsBase {
  type: 'write';
  signal: string;
  from: unknown;
  to: unknown;
  changed: boolean;
  looksEqual?: true;
  context: 'effect' | 'listener' | 'other';
  effect?: number;
  listener?: number;
  stack: string[];

  /** Present when the write came in a burst of more than 200 writes in 100ms: no stack. */
  stackOmitted?: true;
}

export interface EffectDetails extends EventDetailsBase {
  type: 'effect';
  effect: EffectDescription;
  firstRun?: true;
  because: number[];
  changedWithoutWrite?: string[];
  listener?: number;
  outer?: number;
}

export interface ListenerDetails extends EventDetailsBase {
  type: 'listener';
  event: string;
  component: string | null;
  host: string | null;
  effect?: number;
}

export interface CycleDetails extends EventDetailsBase {
  type: 'cycle';
  manual?: true;
  causes: CycleCause[];
  checked: number;
  refreshed: number;
  changed: number;
  changedComponents: string[];
  components: CycleComponentCounts[];
  moreComponents?: number;
  durationMs: number | null;
}

export interface ComponentDetails extends EventDetailsBase {
  type: 'component';
  action: 'created' | 'destroyed';
  component: string;
}

export interface DeferDetails extends EventDetailsBase {
  type: 'defer';
  component: string | null;
  from: DeferStateName;
  to: DeferStateName;
}

export interface ForDetails extends EventDetailsBase {
  type: 'for';
  component: string | null;
  itemCount: number;
  created: number;
  destroyed: number;
  recreatedAll: boolean;
}

export interface TaskAddedDetails extends EventDetailsBase {
  type: 'task_added';
  task: number;
  app: number;
  appWasStable: boolean;
  source: PendingTaskSource;
  addedBy: string | null;
  stack: string[];
}

export interface TaskRemovedDetails extends EventDetailsBase {
  type: 'task_removed';
  task: number;
  app: number;
  added: number | null;
  appStable: boolean;
}

export interface ErrorDetails extends EventDetailsBase {
  type: 'error';
  name: string;
  message: string;
  code?: number;
  stack: string[];
  effect?: number;
  listener?: number;
}

/** An event in full, as `details` returns it. */
export type EventDetails =
  | WriteDetails
  | EffectDetails
  | ListenerDetails
  | CycleDetails
  | ComponentDetails
  | DeferDetails
  | ForDetails
  | TaskAddedDetails
  | TaskRemovedDetails
  | ErrorDetails;

/** Result of {@link eventsTool}. */
export interface EventsResult extends EventLogStatus {
  /** How many events matched the filters, before `limit`. */
  matched: number;

  /** One line per event, oldest first. */
  timeline: string[];

  /** The events asked for with `details`, in full. */
  details?: EventDetails[];
  note?: string;
  truncated?: true;
}

/** Result of {@link eventBufferSizeTool}. */
export interface EventBufferSizeResult extends EventLogStatus {
  previousCapacity: number;

  /** Whether the size was stored for the tab, so that a reload keeps it. */
  persisted: boolean;
}

/** Lines returned unless the caller asks for another number. */
const DEFAULT_LIMIT = 100;

/** The most lines one call returns. */
const MAX_LIMIT = 1000;

/** The most events one call details. */
const MAX_DETAILS = 50;

/** Frames of the code that made a write or added a task, shown in the details of each event. */
const STACK_FRAMES = 5;

/** Characters of a value shown on a timeline line. */
const SHORT_VALUE_LENGTH = 40;

/** Characters of an effect's source shown as its name on a timeline line. */
const SHORT_SOURCE_LENGTH = 40;

const NOT_AVAILABLE_NOTE =
  'The event log is not available on this page: it only exists in a browser in development mode.';

/** Tool that shows AI agents what the application did at runtime, in order, with causes. */
export const eventsTool: ToolDefinition<EventsInput, EventsResult> = {
  name: 'angular:events',
  // tslint:disable-next-line:no-toplevel-property-access
  description: `
Reads the runtime event log of the page: what Angular did, in order, and what caused it. The log
is always on in development mode from the moment Angular starts, so read it after the fact.

Event types: write (a signal was set, including sets that changed nothing and signal inputs set
by a binding), effect (an effect or afterRenderEffect ran), listener (a template or host listener
ran), cycle (change detection ran), component (created or destroyed), defer (a @defer state
change), for (@for rows created or destroyed), task_added and task_removed (pending tasks, which
keep the app from being stable), error (reached the ErrorHandler). The tasks of Angular's own
render scheduling are left out unless \`types\` names task_added or task_removed.

Returns a timeline, one line per event, oldest first:
\`seq @ms type subject summary <-causes\`. \`@ms\` is the time since the page started. A write shows
\`from->to\`, \`=\` when it changed nothing, \`~\` when the new object looks like the old one. \`<-\`
lists the seq of what caused the event: the effect run or listener a write was made in, the writes
that made an effect run, the writes and listeners that scheduled a cycle.
Every type shares one seq, which never restarts. Always check \`dropped\`: the log keeps the newest
\`capacity\` events (100 by default); if what you need is gone, raise it with
angular:event_buffer_size, reproduce the problem, and read again.

Params, all optional and combinable:
- \`types\`: Only these event types.
- \`match\`: Only events whose subject (signal, component, task source) contains this text,
  ignoring case.
- \`since\`: Only events with a seq greater than this.
- \`limit\`: Lines to return, newest kept (default 100, at most 1000).
- \`causesOf\`: A seq. Returns only that event and the chain of events behind it, following the
  cause links.
- \`details\`: Up to 50 seqs. Also returns \`details\`, those events in full: whole values, and the
  code that made a write or added a task, mapped through the dev server's source maps (which
  fetches scripts and maps, so those requests show in the network log).

Returns \`capacity\`, \`size\`, \`dropped\`, \`latestSeq\`, \`oldestSeq\`, \`matched\`, \`timeline\`,
\`details\`, \`note\` (how to narrow a cut result, or what is gone) and \`internalError\` (the log
failed; the app is not affected). Values are live application data, returned without filtering
secrets.
  `.trim(),
  inputSchema: {
    type: 'object',
    properties: {
      types: {
        type: 'array',
        items: {
          type: 'string',
          enum: [
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
          ],
        },
        description: 'Only these event types.',
      },
      match: {
        type: 'string',
        description: 'Only events whose subject contains this text, ignoring case.',
      },
      since: {
        type: 'integer',
        description: 'Only events with a seq greater than this.',
        minimum: 0,
      },
      limit: {
        type: 'integer',
        description: 'Lines to return, newest kept (default 100, at most 1000).',
        minimum: 1,
        maximum: 1000,
      },
      causesOf: {
        type: 'integer',
        description: 'A seq: return only that event and the chain of events behind it.',
        minimum: 1,
      },
      details: {
        type: 'array',
        items: {type: 'integer', minimum: 1},
        description: 'Up to 50 seqs to return in full, with values and source-mapped stacks.',
      },
    },
  },
  execute: async (input: EventsInput = {}) => {
    const {types, match, since = 0, limit = DEFAULT_LIMIT, causesOf, details} = input;
    if (types !== undefined) {
      if (!Array.isArray(types) || types.some((type) => !EVENT_TYPES.includes(type))) {
        throw new Error(`Invalid input: "types" must be an array of ${EVENT_TYPES.join(', ')}.`);
      }
    }
    if (match !== undefined && typeof match !== 'string') {
      throw new Error('Invalid input: "match" must be a string.');
    }
    if (!Number.isInteger(since) || since < 0) {
      throw new Error('Invalid input: "since" must be a non-negative integer.');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new Error(`Invalid input: "limit" must be an integer from 1 to ${MAX_LIMIT}.`);
    }
    if (causesOf !== undefined && (!Number.isInteger(causesOf) || causesOf < 1)) {
      throw new Error('Invalid input: "causesOf" must be a positive integer.');
    }
    if (details !== undefined) {
      if (
        !Array.isArray(details) ||
        details.length > MAX_DETAILS ||
        details.some((seq) => !Number.isInteger(seq) || seq < 1)
      ) {
        throw new Error(
          `Invalid input: "details" must be an array of up to ${MAX_DETAILS} positive integers.`,
        );
      }
    }

    const log = getEventLog();
    if (log === null) {
      return {
        capacity: 0,
        size: 0,
        dropped: 0,
        latestSeq: null,
        oldestSeq: null,
        matched: 0,
        timeline: [],
        note: NOT_AVAILABLE_NOTE,
      };
    }

    const status = log.status();
    const stored = log.read();
    const names = nameSignals();
    const subjects = new Map<StoredEvent, string>();
    const taskSources = await classifyTasks(stored);
    const subjectOf = (event: StoredEvent): string => {
      let subject = subjects.get(event);
      if (subject === undefined) {
        subject = describeSubject(event, names, taskSources);
        subjects.set(event, subject);
      }
      return subject;
    };

    const notes: string[] = [];
    let candidates = stored;
    if (causesOf !== undefined) {
      const chain = findCauseChain(stored, causesOf);
      candidates = chain.events;
      if (chain.missing.length > 0) {
        notes.push(
          `The chain also leads to seq ${chain.missing.join(', ')}, which the log no longer keeps.`,
        );
      }
      if (candidates.length === 0) {
        notes.push(`No event has seq ${causesOf}: it was dropped, or never recorded.`);
      }
    }
    const wanted = types === undefined ? null : new Set(types);
    const needle = match === undefined ? null : match.toLowerCase();
    // The tasks of Angular's own render scheduling say nothing a cycle does not: they are left
    // out unless tasks are asked for.
    const hiddenTasks =
      wanted !== null && (wanted.has('task_added') || wanted.has('task_removed'))
        ? null
        : findRenderTasks(candidates, subjectOf);
    const selected = candidates.filter(
      (event) =>
        event.seq > since &&
        (wanted === null || wanted.has(event.type)) &&
        (needle === null || subjectOf(event).toLowerCase().includes(needle)) &&
        (hiddenTasks === null || !hiddenTasks.has(event.seq)),
    );
    const shown = selected.slice(-limit);

    const timeline = shown.map((event) => describeLine(event, subjectOf(event), names));
    const result: EventsResult = {...status, matched: selected.length, timeline};

    if (details !== undefined && details.length > 0) {
      const bySeq = new Map(stored.map((event) => [event.seq, event]));
      const found = details.map((seq) => bySeq.get(seq)).filter((event) => event !== undefined);
      result.details = await Promise.all(found.map((event) => describeDetails(event, names)));
      if (found.length < details.length) {
        notes.push(
          `Of "details", seq ${details
            .filter((seq) => !bySeq.has(seq))
            .join(', ')} ${found.length + 1 === details.length ? 'is' : 'are'} not in the log.`,
        );
      }
    }

    if (shown.length < selected.length) {
      result.truncated = true;
      notes.push(
        `Showing the newest ${shown.length} of ${selected.length} matching events: narrow with ` +
          '"types", "match" or "since", or raise "limit".',
      );
    }
    if (since > 0 && status.oldestSeq !== null && status.oldestSeq > since + 1) {
      const gone = status.oldestSeq - since - 1;
      notes.push(
        `${gone} event${gone === 1 ? '' : 's'} after seq ${since} ${gone === 1 ? 'is' : 'are'} no ` +
          `longer kept; the log starts at seq ${status.oldestSeq}.`,
      );
    } else if (since > log.latestSeq) {
      notes.push(
        `"since" (${since}) is later than any event on this page; the page may have reloaded. ` +
          'Omit "since" or use a seq from a recent answer.',
      );
    }
    if (status.dropped > 0 && selected.length === 0 && causesOf === undefined) {
      notes.push(
        `No event matched. ${status.dropped} older events were dropped to keep the newest ` +
          `${status.capacity}: raise the size with angular:event_buffer_size and reproduce the ` +
          'problem if the event you need may be among them.',
      );
    }
    if (notes.length > 0) result.note = notes.join(' ');
    return result;
  },
};

/** Tool that sets how many events the log keeps. */
export const eventBufferSizeTool: ToolDefinition<EventBufferSizeInput, EventBufferSizeResult> = {
  name: 'angular:event_buffer_size',
  // tslint:disable-next-line:no-toplevel-property-access
  description: `
Sets how many events the runtime event log of the page keeps; read it with angular:events.

Use it when angular:events reports \`dropped\` above 0 and the event you need is gone: raise the
size, reproduce the problem, and read again. Growing keeps the events held; shrinking drops the
oldest. The size is kept for this tab in sessionStorage, so a reload keeps it: to record a problem
that happens while the page starts, set the size, reload, read. The default is 100; setting it back
to 100 forgets the stored size. A large log takes memory and is slower to read.

Params:
- \`size\` (required): How many events to keep, an integer from 10 to 20000.

Returns \`capacity\` (the size now), \`previousCapacity\`, \`size\`, \`dropped\`, \`latestSeq\`,
\`oldestSeq\`, \`persisted\` (false when storage is unavailable, so a reload goes back to the
default) and \`internalError\`.
  `.trim(),
  inputSchema: {
    type: 'object',
    properties: {
      size: {
        type: 'integer',
        description: 'How many events to keep, from 10 to 20000. The default is 100.',
        minimum: 10,
        maximum: 20000,
      },
    },
    required: ['size'],
  },
  execute: async ({size}: EventBufferSizeInput) => {
    if (!isValidCapacity(size)) {
      throw new Error(
        `Invalid input: "size" must be an integer from ${MIN_CAPACITY} to ${MAX_CAPACITY}.`,
      );
    }
    const previousCapacity = getEventLog()?.status().capacity ?? DEFAULT_CAPACITY;
    const persisted = setEventLogCapacity(size);
    const log = getEventLog();
    if (log === null) {
      return {
        capacity: size,
        previousCapacity,
        size: 0,
        dropped: 0,
        latestSeq: null,
        oldestSeq: null,
        persisted,
        internalError: NOT_AVAILABLE_NOTE,
      };
    }
    return {...log.status(), previousCapacity, persisted};
  },
};

/** The `seq`s of the pending tasks which change detection adds for its own scheduling. */
function findRenderTasks(
  events: StoredEvent[],
  subjectOf: (event: StoredEvent) => string,
): Set<number> {
  const seqs = new Set<number>();
  for (const event of events) {
    if (event.type === 'task_added' && subjectOf(event) === 'change detection') {
      seqs.add(event.seq);
    } else if (event.type === 'task_removed' && event.added !== null && seqs.has(event.added)) {
      seqs.add(event.seq);
    }
  }
  return seqs;
}

/** The `seq`s an event points at as its causes. */
function causeLinks(event: StoredEvent): number[] {
  const links: number[] = [];
  const add = (seq: number | undefined | null) => {
    if (typeof seq === 'number' && !links.includes(seq)) links.push(seq);
  };
  switch (event.type) {
    case 'write':
      add(event.effect);
      add(event.listener);
      break;
    case 'effect':
      event.because.forEach(add);
      add(event.listener);
      add(event.outer);
      break;
    case 'listener':
      add(event.effect);
      break;
    case 'cycle':
      for (const cause of event.causes) {
        if ('seq' in cause) add(cause.seq);
      }
      break;
    case 'task_removed':
      add(event.added);
      break;
    case 'error':
      add(event.effect);
      add(event.listener);
      break;
  }
  return links;
}

/**
 * The event `seq` and every event behind it, following cause links, oldest first, and the `seq`s
 * the chain leads to which the log no longer keeps.
 */
function findCauseChain(
  stored: StoredEvent[],
  seq: number,
): {events: StoredEvent[]; missing: number[]} {
  const bySeq = new Map(stored.map((event) => [event.seq, event]));
  const found = new Map<number, StoredEvent>();
  const missing: number[] = [];
  const queue = [seq];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    if (found.has(current)) continue;
    const event = bySeq.get(current);
    if (event === undefined) {
      if (!missing.includes(current)) missing.push(current);
      continue;
    }
    found.set(current, event);
    queue.push(...causeLinks(event));
  }
  return {events: [...found.values()].sort((a, b) => a.seq - b.seq), missing: missing.sort()};
}

/** What an event is about, for `match` and the timeline. */
function describeSubject(
  event: StoredEvent,
  names: Map<ReactiveNode, string>,
  taskSources: Map<StoredEvent, PendingTaskSource>,
): string {
  switch (event.type) {
    case 'write':
      return nameSignal(event.signal, names);
    case 'effect':
      return nameEffect(event.effect);
    case 'listener':
      return event.component ?? '';
    case 'cycle':
      return '';
    case 'component':
    case 'defer':
    case 'for':
      return event.component ?? '';
    case 'task_added':
      return taskSources.get(event) ?? 'PendingTasks';
    case 'task_removed':
      return '';
    case 'error':
      return event.name;
  }
}

/** One timeline line for an event. */
function describeLine(
  event: StoredEvent,
  subject: string,
  names: Map<ReactiveNode, string>,
): string {
  const parts = [String(event.seq), `@${event.atMs}ms`, event.type];
  if (subject !== '') parts.push(subject);
  const summary = describeSummary(event, names);
  if (summary !== '') parts.push(summary);
  const links = causeLinks(event);
  if (links.length > 0) parts.push(`<-${links.join(',')}`);
  return parts.join(' ');
}

function describeSummary(event: StoredEvent, names: Map<ReactiveNode, string>): string {
  switch (event.type) {
    case 'write': {
      const change = `${shortValue(event.from)}->${shortValue(event.to)}`;
      if (!event.changed) return `${change} =`;
      return event.looksEqual ? `${change} ~` : change;
    }
    case 'effect': {
      const notes: string[] = [];
      if (event.firstRun) notes.push('first run');
      if (event.changedWithoutWrite.length > 0) {
        notes.push(
          `changed without a write: ${event.changedWithoutWrite
            .map((signal) => nameSignal(signal, names))
            .join(',')}`,
        );
      }
      return notes.join(', ');
    }
    case 'listener':
      return `${event.event}${event.host === null ? '' : ` on ${event.host}`}`;
    case 'cycle': {
      const parts = [
        `checked ${event.checked} refreshed ${event.refreshed} changed ${event.changed}`,
      ];
      if (event.changedComponents.length > 0) parts.push(`[${event.changedComponents.join(',')}]`);
      if (event.durationMs !== null) parts.push(`${event.durationMs}ms`);
      if (event.manual) parts.push('manual');
      const other = event.causes
        .filter((cause) => !('seq' in cause) || cause.seq === undefined)
        .map(describeCause);
      if (other.length > 0) parts.push(`because ${other.join(',')}`);
      return parts.join(' ');
    }
    case 'component':
      return event.action;
    case 'defer':
      return `${event.from}->${event.to}`;
    case 'for':
      return (
        `+${event.created} -${event.destroyed} (${event.itemCount} rows)` +
        (event.recreatedAll ? ' recreated all' : '')
      );
    case 'task_added':
      return `#${event.task} app${event.app}${event.appWasStable ? ' (app now unstable)' : ''}`;
    case 'task_removed':
      return `#${event.task} app${event.app}${event.appStable ? ' (app now stable)' : ''}`;
    case 'error':
      return shortText(event.message);
  }
}

function describeCause(cause: CycleCause): string {
  switch (cause.kind) {
    case 'signal':
      return `signal${cause.component ? ` in ${cause.component}` : ''}`;
    case 'zone':
      return `zone${cause.source ? `:${cause.source}` : ''}`;
    case 'notification':
      return cause.source;
    default:
      return cause.kind;
  }
}

/** What added each pending task among `events`. */
async function classifyTasks(events: StoredEvent[]): Promise<Map<StoredEvent, PendingTaskSource>> {
  const sources = new Map<StoredEvent, PendingTaskSource>();
  await Promise.all(
    events.map(async (event) => {
      if (event.type !== 'task_added') return;
      sources.set(event, classifyPendingTask(await readStack(event.stack)).source);
    }),
  );
  return sources;
}

async function describeDetails(
  event: StoredEvent,
  names: Map<ReactiveNode, string>,
): Promise<EventDetails> {
  switch (event.type) {
    case 'write': {
      const {signal, stack, effect, listener, ...rest} = event;
      const described: WriteDetails = {
        ...rest,
        signal: nameSignal(signal, names),
        context: contextOf(effect, listener),
        stack: stack === null ? [] : await showStack(await readStack(stack)),
      };
      if (stack === null) described.stackOmitted = true;
      if (effect !== undefined) described.effect = effect;
      if (listener !== undefined) described.listener = listener;
      return described;
    }
    case 'effect': {
      const {effect, firstRun, changedWithoutWrite, ...rest} = event;
      const described: EffectDetails = {...rest, effect: describeEffect(effect)};
      if (firstRun) described.firstRun = true;
      if (changedWithoutWrite.length > 0) {
        described.changedWithoutWrite = changedWithoutWrite.map((signal) =>
          nameSignal(signal, names),
        );
      }
      return described;
    }
    case 'cycle': {
      const {manual, moreComponents, ...rest} = event;
      const described: CycleDetails = {...rest};
      if (manual) described.manual = true;
      if (moreComponents > 0) described.moreComponents = moreComponents;
      return described;
    }
    case 'task_added': {
      const {stack, ...rest} = event;
      const frames = await readStack(stack);
      const {source, addedBy} = classifyPendingTask(frames);
      return {...rest, source, addedBy, stack: await showStack(frames)};
    }
    case 'error': {
      const {stack, ...rest} = event;
      return {
        ...rest,
        stack: stack === null ? [] : await showStack(await readStack({stack} as Error)),
      };
    }
    default:
      return event;
  }
}

function nameSignal(signal: StoredSignal, names: Map<ReactiveNode, string>): string {
  const node = signal.ref.deref();
  if (node !== undefined) return nameOf(node, names);
  return signal.debugName ?? '(collected signal)';
}

/** A short name for an effect: its debug name, its owner, or the start of its source. */
function nameEffect(effect: StoredEffect): string {
  if (effect.debugName !== undefined) return effect.debugName;
  const kind = effect.kind === 'afterRenderEffect' ? `afterRenderEffect:${effect.phase}` : 'effect';
  if (effect.owner !== null) return `${effect.owner} ${kind}`;
  const source = describeEffect(effect).source;
  return source === null ? kind : shortText(source, SHORT_SOURCE_LENGTH);
}

function describeEffect(effect: StoredEffect): EffectDescription {
  const node = effect.ref.deref() as {userFn?: Function} | undefined;
  const userFn = node?.userFn;
  const described: EffectDescription = {
    kind: effect.kind,
    source: typeof userFn === 'function' ? capString(String(userFn).replace(/\s+/g, ' ')) : null,
  };
  if (effect.phase !== undefined) described.phase = effect.phase;
  if (effect.owner !== null) described.owner = effect.owner;
  if (effect.debugName !== undefined) described.debugName = effect.debugName;
  return described;
}

/** Tells what was running when a signal was written: the innermost of the effect and listener. */
function contextOf(
  effect: number | undefined,
  listener: number | undefined,
): 'effect' | 'listener' | 'other' {
  if (effect === undefined && listener === undefined) return 'other';
  if (listener === undefined || (effect !== undefined && effect > listener)) return 'effect';
  return 'listener';
}

/** A serialized value on one short line, such as `'billing'`, `[1,2,…]` or `{id:1,…}`. */
function shortValue(value: unknown, budget = SHORT_VALUE_LENGTH): string {
  return shortText(formatValue(value, budget), budget);
}

function formatValue(value: unknown, budget: number): string {
  if (typeof value === 'string') return `'${value}'`;
  if (typeof value !== 'object' || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    let length = 1;
    for (const item of value) {
      const part = formatValue(item, budget);
      if (length + part.length > budget) {
        parts.push('…');
        break;
      }
      parts.push(part);
      length += part.length + 1;
    }
    return `[${parts.join(',')}]`;
  }
  const parts: string[] = [];
  let length = 1;
  for (const [key, item] of Object.entries(value)) {
    const part = `${key}:${formatValue(item, budget)}`;
    if (length + part.length > budget) {
      parts.push('…');
      break;
    }
    parts.push(part);
    length += part.length + 1;
  }
  return `{${parts.join(',')}}`;
}

/** Cuts `text` to at most `max` characters, keeping one line. */
function shortText(text: string, max = 80): string {
  const line = text.replace(/\s+/g, ' ');
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

async function showStack(frames: RawStackFrame[]): Promise<string[]> {
  return (await resolveStack(frames, STACK_FRAMES)).map(({location, fn}) =>
    fn === null ? location : `${location} (${stripLeadingUnderscore(fn)})`,
  );
}
