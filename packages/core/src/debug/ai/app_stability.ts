/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {PendingTasksInternal} from '../../pending_tasks_internal';
import {getLContext} from '../../render3/context_discovery';
import {getInjector} from '../../render3/util/discovery_utils';
import {NgZone, NoopNgZone} from '../../zone/ng_zone';
import {ToolDefinition} from '../../../primitives/devtools';
import {getEventLog} from './event_log';
import {stripLeadingUnderscore} from './shared/names';
import {classifyPendingTask, PendingTaskSource} from './shared/pending_task_source';
import {RawStackFrame, readStack, resolveStack} from './shared/stack_frames';

export type {PendingTaskSource};

/** A task keeping an application from becoming stable. */
export interface PendingTaskInfo {
  /** Milliseconds since the task was added. */
  ageMs: number;
  source: PendingTaskSource;

  /** The function which added the task, outside of `PendingTasks`. */
  addedBy: string | null;

  /** The code which added the task, innermost first, without the frames of Angular. */
  stack: string[];
}

/** The stability of one application on the page. */
export interface ApplicationStability {
  /** The tag name of the root element, in lower case. */
  root: string;
  stable: boolean;

  /** Milliseconds since the application last went from no pending task to one. */
  unstableForMs?: number;

  /** The pending tasks, oldest first. */
  pendingTasks: PendingTaskInfo[];

  /** For an application using zone.js: what the Angular zone has pending. */
  zone?: {
    pendingMacrotasks: boolean;

    /** The pending macrotasks, when zone.js task tracking is loaded. */
    macrotasks?: Array<{source: string; stack: string[]}>;
    note?: string;
  };
}

/** Result of {@link appStabilityTool}. */
export interface AppStability {
  apps: ApplicationStability[];
}

/** Frames of the code which added a task, shown for each task. */
const STACK_FRAMES = 6;

/** Tool that tells AI agents what keeps an application from becoming stable. */
export const appStabilityTool: ToolDefinition<{}, AppStability> = {
  name: 'angular:app_stability',
  description: `
Tells whether each Angular application on the page is stable, and what keeps it from becoming
stable.

An application is stable when it has no pending task: no HTTP request through \`HttpClient\`, no
router navigation, no \`@defer\` block or \`resource()\` loading, no change detection scheduled, no
task added with \`PendingTasks\`, and, with zone.js, no macrotask such as a timer pending in the
Angular zone. Use this tool when something which waits for stability never happens or happens
late: \`ApplicationRef.whenStable()\` or \`isStable\`, hydration (NG0506), server-side rendering, a
service worker registered "when stable", or a test waiting with \`whenStable()\`. A task which
never completes keeps the application unstable forever, and it is often added by a library.

Angular records where each task was added from the time the application starts, so this tool can
tell where every pending task comes from, however long ago it was added. It only reads: it never
completes, cancels or adds a task, and it never runs change detection.

To map the code which added a task to the original sources, the tool fetches the scripts of the
page and their source maps from the dev server, so those requests show in the network log.

Returns:
- \`apps\`: One entry per application root on the page:
  - \`root\`: The tag name of the root element, in lower case.
  - \`stable\`: Whether the application has no pending task.
  - \`unstableForMs\`: When not stable, milliseconds since the application last had no pending
    task.
  - \`pendingTasks\`: The pending tasks, oldest first, each:
    - \`ageMs\`: Milliseconds since the task was added.
    - \`source\`: What added it: \`'HttpClient'\`, \`'Router'\`, \`'@defer'\`, \`'resource'\`,
      \`'change detection'\` (a render Angular has scheduled), \`'zone.js'\` (the Angular zone has
      work pending, see \`zone\`), \`'bootstrap'\`, or \`'PendingTasks'\` (code calling
      \`PendingTasks.add()\` or \`PendingTasks.run()\` directly, such as a library).
    - \`addedBy\`: The function which added the task.
    - \`stack\`: The code which added the task, innermost first, as \`file:line:column (function)\`,
      mapped to the original sources when the dev server serves source maps. Frames of Angular
      and of rxjs are left out, so the first frame is usually the application or library code
      responsible.
  - \`zone\`: For an application using zone.js: \`pendingMacrotasks\`, and the pending
    \`macrotasks\` with the stack which scheduled each, when \`zone.js/plugins/task-tracking\` is
    loaded. Without it, \`note\` says so.
  `.trim(),
  inputSchema: {type: 'object', properties: {}},
  execute: async () => {
    const apps: ApplicationStability[] = [];
    const seen = new Set<PendingTasksInternal>();
    for (const root of Array.from(document.querySelectorAll('[ng-version]'))) {
      if (!getLContext(root)?.lView) continue;
      const injector = getInjector(root);
      const tasks = injector.get(PendingTasksInternal, null);
      if (tasks === null || seen.has(tasks)) continue;
      seen.add(tasks);
      apps.push(await describeApplication(root, tasks, injector.get(NgZone, null)));
    }
    if (apps.length === 0) {
      throw new Error('Could not find Angular root element ([ng-version]) on the page.');
    }
    return {apps};
  },
};

async function describeApplication(
  root: Element,
  tasks: PendingTasksInternal,
  zone: NgZone | null,
): Promise<ApplicationStability> {
  const now = performance.now();
  const log = getEventLog();
  const pending = log?.pendingTasksOf(tasks) ?? [];

  const app: ApplicationStability = {
    root: root.tagName.toLowerCase(),
    stable: !tasks.hasPendingTasks,
    pendingTasks: await Promise.all(
      pending.map(async ({addedAt, stack}) => {
        const frames = await readStack(stack);
        const {source, addedBy} = classifyPendingTask(frames);
        return {
          ageMs: Math.round(now - addedAt),
          source,
          addedBy,
          stack: await showStack(frames),
        };
      }),
    ),
  };
  const since = log?.unstableSinceOf(tasks);
  if (!app.stable && since !== undefined) app.unstableForMs = Math.round(now - since);
  if (zone !== null && !(zone instanceof NoopNgZone) && getZoneJs() !== undefined) {
    app.zone = await describeZone(zone);
  }
  return app;
}

/** zone.js, when it is on the page. */
function getZoneJs(): {current: {get(key: string): unknown}} | undefined {
  return (globalThis as {Zone?: {current: {get(key: string): unknown}}}).Zone;
}

async function describeZone(zone: NgZone): Promise<ApplicationStability['zone']> {
  const described: NonNullable<ApplicationStability['zone']> = {
    pendingMacrotasks: zone.hasPendingMacrotasks,
  };
  const tracking = getTaskTracking(zone);
  if (tracking?.macroTasks) {
    described.macrotasks = await Promise.all(
      tracking.macroTasks.map(async (task) => ({
        source: task.source ?? 'unknown',
        stack: task.creationLocation ? await showStack(await readStack(task.creationLocation)) : [],
      })),
    );
  } else if (described.pendingMacrotasks) {
    described.note =
      'Load zone.js/plugins/task-tracking before the application starts to see which macrotasks ' +
      'are pending and where they were scheduled.';
  }
  return described;
}

/** The task tracking zone of zone.js, when `zone.js/plugins/task-tracking` is loaded. */
function getTaskTracking(
  zone: NgZone,
): {macroTasks?: Array<{source?: string; creationLocation?: Error}>} | null {
  try {
    const tracking = zone.run(() => getZoneJs()?.current.get('TaskTrackingZone'));
    return (tracking ?? null) as {
      macroTasks?: Array<{source?: string; creationLocation?: Error}>;
    } | null;
  } catch {
    return null;
  }
}

async function showStack(frames: RawStackFrame[]): Promise<string[]> {
  return (await resolveStack(frames, STACK_FRAMES)).map(({location, fn}) =>
    fn === null ? location : `${location} (${stripLeadingUnderscore(fn)})`,
  );
}
