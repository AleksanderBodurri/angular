/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {stripLeadingUnderscore} from './names';
import {RawStackFrame} from './stack_frames';

/** What added a pending task, judged from the code which added it. */
export type PendingTaskSource =
  | 'HttpClient'
  | 'Router'
  | '@defer'
  | 'resource'
  | 'change detection'
  | 'zone.js'
  | 'bootstrap'
  | 'PendingTasks';

/** Frames of the code which records and adds tasks, whatever added them. */
const TASK_FRAME =
  /(^|\.)(captureStack|EventLog\.onPendingTaskAdded|PendingTasksInternal\.add|PendingTasks\.(add|run))$/;

/** The frame of the public API, the only way for code outside of Angular to add a task. */
const PUBLIC_TASK_FRAME = /(^|\.)PendingTasks\.add$/;

const SOURCES: Array<[RegExp, PendingTaskSource]> = [
  [/Http|Interceptor|FetchBackend|XhrBackend/, 'HttpClient'],
  [/Router|Navigation/, 'Router'],
  [/[Dd]efer|triggerResourceLoading/, '@defer'],
  [/[Rr]esource/, 'resource'],
  [/ChangeDetectionScheduler|Zoneless/, 'change detection'],
  // Not `NoopNgZone`, which a zoneless application runs everything through.
  [/\bNgZone/, 'zone.js'],
  [/[Bb]ootstrap/, 'bootstrap'],
];

/**
 * Tells what added a task from the first frame outside of `PendingTasks`. A task added without the
 * public API is Angular's own, as for a callback the change detection scheduler subscribes, and
 * the name of its source can be further down the stack, so it is looked for there. The stack of a
 * task added through the public API says nothing further down: any code can run during a tick.
 */
export function classifyPendingTask(frames: RawStackFrame[]): {
  source: PendingTaskSource;
  addedBy: string | null;
} {
  const caller = frames.find(({fn}) => fn === null || !TASK_FRAME.test(stripLeadingUnderscore(fn)));
  const addedBy = caller?.fn ? stripLeadingUnderscore(caller.fn) : null;
  const named = addedBy === null ? undefined : sourceOf(addedBy);
  if (named !== undefined) return {source: named, addedBy};
  if (!frames.some(({fn}) => fn !== null && PUBLIC_TASK_FRAME.test(stripLeadingUnderscore(fn)))) {
    for (const {fn} of frames) {
      const source = fn === null ? undefined : sourceOf(stripLeadingUnderscore(fn));
      if (source !== undefined) return {source, addedBy};
    }
  }
  return {source: 'PendingTasks', addedBy};
}

function sourceOf(functionName: string): PendingTaskSource | undefined {
  return SOURCES.find(([pattern]) => pattern.test(functionName))?.[1];
}
