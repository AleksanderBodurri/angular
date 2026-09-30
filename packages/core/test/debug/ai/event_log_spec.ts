/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {
  afterRenderEffect,
  ChangeDetectorRef,
  Component,
  destroyPlatform,
  effect,
  ErrorHandler,
  EventEmitter,
  inject,
  Injectable,
  input,
  Input,
  linkedSignal,
  Output,
  PendingTasks,
  PLATFORM_ID,
  provideZonelessChangeDetection,
  signal,
  Type,
  untracked,
  ViewChild,
  WritableSignal,
} from '@angular/core';
import {ComponentFixture, TestBed} from '@angular/core/testing';
import {ɵPLATFORM_BROWSER_ID as PLATFORM_BROWSER_ID} from '@angular/common';
import {bootstrapApplication} from '@angular/platform-browser';
import {withBody} from '@angular/private/testing';
import {
  EventLog,
  getEventLog,
  installEventLog,
  StoredEffectRun,
  StoredEvent,
  StoredSignalWrite,
  uninstallEventLog,
} from '../../../src/debug/ai/event_log';
import {
  eventBufferSizeTool,
  EventsInput,
  eventsTool,
  EventDetails,
} from '../../../src/debug/ai/event_log_tools';
import {classifyPendingTask} from '../../../src/debug/ai/shared/pending_task_source';
import {parseStack, withClassName} from '../../../src/debug/ai/shared/stack_frames';

@Injectable({providedIn: 'root'})
class ElSession {
  readonly user = signal({id: 1, name: 'Ada'});
}

@Injectable({providedIn: 'root'})
class ElStore {
  private readonly session = inject(ElSession);
  readonly tab = signal('general');
  readonly items = signal<string[]>([]);
  readonly plan = signal('free');

  /** Reset when the plan changes; otherwise set by hand. */
  readonly seats = linkedSignal<number>(() => (this.plan() === 'pro' ? 5 : 1));

  constructor() {
    // Switching users starts over on the first tab.
    effect(() => {
      this.session.user();
      untracked(() => this.tab.set('general'));
    });
  }
}

@Component({selector: 'el-child', template: '{{ label() }}:{{ legacy }}'})
class ElChild {
  // JIT tests declare signal inputs with the decorator the compiler would add.
  @Input({isSignal: true} as Input) readonly label = input('');
  @Input() legacy = '';
}

@Component({
  selector: 'el-tabs',
  imports: [ElChild],
  template: `
    <button (click)="pick()">Billing</button>
    {{ store.tab() }} {{ count() > 0 }}
    @if (showChild()) {
      <el-child [label]="childLabel()" [legacy]="childLabel()" />
    }
    @for (item of store.items(); track item) {
      <span>{{ item }}</span>
    }
  `,
})
class ElTabs {
  readonly store = inject(ElStore);
  readonly showChild = signal(false);
  readonly childLabel = signal('a');
  readonly count = signal(0);
  readonly cdr = inject(ChangeDetectorRef);

  pick(): void {
    this.store.tab.set('billing');
  }
}

/** Root elements attached to the document, as the tool names the signals of the page. */
const attached: HTMLElement[] = [];

/** The `seq` of the last event before the part of a test which is read. */
let since = 0;

function log(): EventLog {
  installEventLog();
  return getEventLog()!;
}

/** Renders a component on the page and starts reading after its first render. */
async function render<T = ElTabs>(type: Type<T> = ElTabs as Type<T>): Promise<ComponentFixture<T>> {
  const fixture = TestBed.createComponent(type);
  document.body.appendChild(fixture.nativeElement);
  attached.push(fixture.nativeElement);
  await fixture.whenStable();
  since = log().latestSeq;
  return fixture;
}

/** Reads the timeline, then the events on it in full. */
async function read(input: EventsInput = {}): Promise<EventDetails[]> {
  const seqs = seqsOf((await eventsTool.execute(input)).timeline);
  if (seqs.length === 0) return [];
  return (await eventsTool.execute({details: seqs.slice(0, 50)})).details!;
}

/** The `seq` of each timeline line. */
function seqsOf(timeline: string[]): number[] {
  return timeline.map((line) => Number(line.split(' ')[0]));
}

function ofType<T extends EventDetails['type']>(
  events: EventDetails[],
  type: T,
): Array<Extract<EventDetails, {type: T}>> {
  return events.filter((event) => event.type === type) as Array<Extract<EventDetails, {type: T}>>;
}

describe('event log', () => {
  beforeEach(() => {
    // Whatever the other specs of the suite did, the log must still be recording.
    expect(log().status().internalError).withContext('the log failed').toBeUndefined();
    since = log().latestSeq;
  });

  afterEach(() => {
    attached.splice(0).forEach((element) => element.remove());
  });

  describe('signal writes', () => {
    it('should be installed before any application exists and record a write made outside Angular', async () => {
      expect(getEventLog()).not.toBeNull();
      const loose = signal(1, {debugName: 'loose'});

      loose.set(2);

      const [write] = ofType(await read({since}), 'write');
      expect(write).toEqual(
        jasmine.objectContaining({
          signal: 'loose',
          from: 1,
          to: 2,
          changed: true,
          context: 'other',
          stack: jasmine.any(Array),
        }),
      );
      expect(write.stack.length).toBeGreaterThan(0);
      expect(write.cycle).toBeUndefined();
    });

    it('should name a signal after the field holding it and give "from" on its first write', async () => {
      const fixture = await render();

      fixture.componentInstance.count.set(1);
      await fixture.whenStable();

      const [write] = ofType(await read({since}), 'write');
      expect(write).toEqual(jasmine.objectContaining({signal: 'ElTabs.count', from: 0, to: 1}));
    });

    it('should record a write which changes nothing', async () => {
      await render();
      const store = TestBed.inject(ElStore);
      since = log().latestSeq;

      store.items().push('one');
      store.items.set(store.items());

      const [write] = ofType(await read({since}), 'write');
      expect(write).toEqual(
        jasmine.objectContaining({
          signal: 'ElStore.items',
          from: ['one'],
          to: ['one'],
          changed: false,
        }),
      );
      expect(write.looksEqual).toBeUndefined();
    });

    it('should tell when a new object looks like the previous one', async () => {
      const session = TestBed.inject(ElSession);
      since = log().latestSeq;

      session.user.set({id: 1, name: 'Ada'});

      const [write] = ofType(await read({since}), 'write');
      expect(write).toEqual(jasmine.objectContaining({changed: true, looksEqual: true}));
    });

    it('should tell when a new object looks like the previous one further down', async () => {
      const settings = signal({theme: {colors: {accent: 'red'}}}, {debugName: 'nestedSame'});
      since = log().latestSeq;

      settings.set({theme: {colors: {accent: 'red'}}});

      const [write] = ofType(await read({since}), 'write');
      expect(write).toEqual(jasmine.objectContaining({changed: true, looksEqual: true}));
    });

    it('should not say a new object looks like the previous one when it differs further down', async () => {
      const settings = signal({theme: {colors: {accent: 'red'}}}, {debugName: 'nestedOther'});
      since = log().latestSeq;

      settings.set({theme: {colors: {accent: 'blue'}}});

      const result = await eventsTool.execute({since, details: [since + 1]});
      expect(result.details![0]).toEqual(jasmine.objectContaining({changed: true}));
      expect((result.details![0] as {looksEqual?: true}).looksEqual).toBeUndefined();
      expect(result.timeline[0]).not.toMatch(/ ~$/);
    });

    it('should give the value a linkedSignal was reset to as "from" of the next write', async () => {
      await render();
      const store = TestBed.inject(ElStore);
      store.seats.set(3);
      since = log().latestSeq;

      // Nothing reads `seats` between the reset and the write.
      store.plan.set('pro');
      store.seats.set(7);

      const [, write] = ofType(await read({since}), 'write');
      expect(write).toEqual(jasmine.objectContaining({signal: 'ElStore.seats', from: 5, to: 7}));
    });

    it('should not make an effect depend on the values the log reads', async () => {
      const fixture = await render();
      const inner = signal(1);
      const holder: WritableSignal<{inner: WritableSignal<number>} | null> = signal(null);
      const trigger = signal(0);
      let runs = 0;
      TestBed.runInInjectionContext(() =>
        effect(() => {
          trigger();
          runs++;
          // The log serializes the new value, reading `inner`, while this effect runs.
          holder.set({inner});
        }),
      );
      await fixture.whenStable();
      const runsBefore = runs;

      inner.set(2);
      await fixture.whenStable();

      expect(runs).toBe(runsBefore);
    });
  });

  describe('effects', () => {
    it('should record an effect run with the writes which made it run, and the write it made', async () => {
      const fixture = await render();
      const session = TestBed.inject(ElSession);
      const store = TestBed.inject(ElStore);
      store.tab.set('billing');
      await fixture.whenStable();
      since = log().latestSeq;

      session.user.set({id: 2, name: 'Bob'});
      await fixture.whenStable();

      const events = await read({since});
      const [userWrite, reset] = ofType(events, 'write');
      const [run] = ofType(events, 'effect');
      expect(userWrite.signal).toBe('ElSession.user');
      expect(run).toEqual(
        jasmine.objectContaining({
          because: [userWrite.seq],
          effect: jasmine.objectContaining({
            kind: 'effect',
            source: jasmine.stringContaining('untracked'),
          }),
        }),
      );
      expect(run.firstRun).toBeUndefined();
      expect(reset).toEqual(
        jasmine.objectContaining({
          signal: 'ElStore.tab',
          from: 'billing',
          to: 'general',
          context: 'effect',
          effect: run.seq,
        }),
      );
    });

    it('should record an effect which writes nothing, and its first run', async () => {
      const fixture = await render();
      const watched = signal(0, {debugName: 'watched'});
      let seen = 0;
      TestBed.runInInjectionContext(() => effect(() => void (seen = watched())));
      await fixture.whenStable();
      const [first] = ofType(await read({since}), 'effect');
      expect(first.firstRun).toBeTrue();
      since = log().latestSeq;

      watched.set(1);
      await fixture.whenStable();

      expect(seen).toBe(1);
      const events = await read({since});
      const [write] = ofType(events, 'write');
      const [run] = ofType(events, 'effect');
      expect(run).toEqual(jasmine.objectContaining({because: [write.seq]}));
      expect(run.firstRun).toBeUndefined();
    });

    it('should record afterRenderEffect runs and the writes they make', async () => {
      @Component({selector: 'el-after', template: '{{ count() }}'})
      class ElAfter {
        readonly count = signal(0);
        readonly measured = signal(-1);
        constructor() {
          afterRenderEffect(() => {
            this.measured.set(this.count() * 10);
          });
        }
      }
      TestBed.configureTestingModule({
        providers: [{provide: PLATFORM_ID, useValue: PLATFORM_BROWSER_ID}],
      });
      const fixture = await render(ElAfter);
      expect(fixture.componentInstance.measured()).toBe(0);
      since = log().latestSeq;

      fixture.componentInstance.count.set(2);
      await fixture.whenStable();

      expect(fixture.componentInstance.measured()).toBe(20);
      const events = await read({since});
      const [countWrite, measuredWrite] = ofType(events, 'write');
      const [run] = ofType(events, 'effect');
      expect(run).toEqual(
        jasmine.objectContaining({
          because: [countWrite.seq],
          effect: jasmine.objectContaining({
            kind: 'afterRenderEffect',
            phase: 'mixedReadWrite',
            owner: 'ElAfter',
          }),
        }),
      );
      expect(measuredWrite).toEqual(
        jasmine.objectContaining({
          signal: 'ElAfter.measured',
          to: 20,
          context: 'effect',
          effect: run.seq,
        }),
      );
    });
  });

  describe('listeners and change detection', () => {
    it('should record a listener, the write it made, and the cycle it caused', async () => {
      const fixture = await render();
      since = log().latestSeq;

      (fixture.nativeElement as HTMLElement).querySelector('button')!.click();
      await fixture.whenStable();

      const events = await read({since});
      const [listener] = ofType(events, 'listener');
      expect(listener).toEqual(
        jasmine.objectContaining({event: 'click', component: 'ElTabs', host: 'button'}),
      );
      const [write] = ofType(events, 'write');
      expect(write).toEqual(
        jasmine.objectContaining({
          signal: 'ElStore.tab',
          to: 'billing',
          context: 'listener',
          listener: listener.seq,
        }),
      );
      const [cycle] = ofType(events, 'cycle');
      expect(cycle.causes).toContain({kind: 'listener', seq: listener.seq});
      expect(cycle.causes).toContain({kind: 'signal', seq: write.seq, component: 'ElTabs'});
      expect(cycle.changed).toBe(1);
      expect(cycle.changedComponents).toEqual(['ElTabs']);
      expect(cycle.seq).toBeGreaterThan(write.seq);
    });

    it('should name the output a listener is bound to', async () => {
      @Component({selector: 'el-picker', template: ''})
      class ElPicker {
        @Output() readonly picked = new EventEmitter<string>();
      }
      @Component({
        selector: 'el-picker-host',
        imports: [ElPicker],
        template: '<el-picker (picked)="last.set($event)" />',
      })
      class ElPickerHost {
        @ViewChild(ElPicker) picker!: ElPicker;
        readonly last = signal('');
      }
      const fixture = await render(ElPickerHost);
      since = log().latestSeq;

      fixture.componentInstance.picker.picked.emit('a');
      await fixture.whenStable();

      const {timeline} = await eventsTool.execute({since, types: ['listener']});
      expect(timeline).toEqual([
        jasmine.stringMatching(/ listener ElPickerHost picked on el-picker$/),
      ]);
    });

    it('should record a cycle which changed nothing, with its counts', async () => {
      const fixture = await render();
      fixture.componentInstance.count.set(1);
      await fixture.whenStable();
      since = log().latestSeq;

      fixture.componentInstance.count.set(2);
      await fixture.whenStable();

      const [cycle] = ofType(await read({since}), 'cycle');
      expect(cycle).toEqual(
        jasmine.objectContaining({
          changed: 0,
          checked: 1,
          refreshed: 1,
          changedComponents: [],
          components: [{component: 'ElTabs', checked: 1, refreshed: 1, changed: 0}],
          durationMs: jasmine.any(Number),
        }),
      );
      expect(cycle.manual).toBeUndefined();
    });

    it('should record a manual change detection run', async () => {
      const fixture = await render();
      since = log().latestSeq;

      fixture.componentInstance.cdr.detectChanges();

      const [cycle] = ofType(await read({since}), 'cycle');
      expect(cycle).toEqual(
        jasmine.objectContaining({manual: true, causes: [{kind: 'detectChanges'}]}),
      );
    });
  });

  describe('components and control flow', () => {
    it('should record a child created and destroyed', async () => {
      const fixture = await render();
      since = log().latestSeq;

      fixture.componentInstance.showChild.set(true);
      await fixture.whenStable();

      expect(ofType(await read({since}), 'component')).toEqual([
        jasmine.objectContaining({
          action: 'created',
          component: 'ElChild',
          cycle: jasmine.any(Number),
        }),
      ]);
      since = log().latestSeq;

      fixture.componentInstance.showChild.set(false);
      await fixture.whenStable();

      expect(ofType(await read({since}), 'component')).toEqual([
        jasmine.objectContaining({action: 'destroyed', component: 'ElChild'}),
      ]);
    });

    it('should record a signal input set by a binding as a write of the input', async () => {
      const fixture = await render();
      fixture.componentInstance.showChild.set(true);
      await fixture.whenStable();
      since = log().latestSeq;

      fixture.componentInstance.childLabel.set('b');
      await fixture.whenStable();

      const events = await read({since});
      const [cycle] = ofType(events, 'cycle');
      expect(ofType(events, 'write')).toEqual([
        jasmine.objectContaining({signal: 'ElTabs.childLabel', from: 'a', to: 'b'}),
        jasmine.objectContaining({
          signal: 'ElChild.label',
          from: 'a',
          to: 'b',
          changed: true,
          cycle: cycle.seq,
        }),
      ]);
    });

    it('should record the rows a @for update creates and destroys', async () => {
      const fixture = await render();
      const store = TestBed.inject(ElStore);
      since = log().latestSeq;

      store.items.set(['a', 'b']);
      await fixture.whenStable();
      store.items.set(['c', 'd']);
      await fixture.whenStable();

      expect(ofType(await read({since}), 'for')).toEqual([
        jasmine.objectContaining({
          component: 'ElTabs',
          itemCount: 2,
          created: 2,
          destroyed: 0,
          recreatedAll: false,
        }),
        jasmine.objectContaining({
          component: 'ElTabs',
          itemCount: 2,
          created: 2,
          destroyed: 2,
          recreatedAll: true,
        }),
      ]);
    });

    it('should record the state changes of a @defer block', async () => {
      @Component({
        selector: 'el-defer',
        imports: [ElChild],
        template: `
          @defer (when ready()) {
            <el-child />
          } @placeholder {
            <p>soon</p>
          }
        `,
      })
      class ElDefer {
        readonly ready = signal(false);
      }
      const fixture = await render(ElDefer);
      since = log().latestSeq;

      fixture.componentInstance.ready.set(true);
      await fixture.whenStable();

      const changes = ofType(await read({since}), 'defer');
      expect(changes.length).toBeGreaterThan(0);
      expect(changes[changes.length - 1]).toEqual(
        jasmine.objectContaining({component: 'ElDefer', to: 'complete'}),
      );
      expect(changes[0].from).toBe('placeholder');
    });
  });

  describe('pending tasks and errors', () => {
    it('should record pending tasks and the stability of the application', async () => {
      const fixture = await render();
      const pendingTasks = TestBed.inject(PendingTasks);
      since = log().latestSeq;

      function waitForTheFirstMessage(): () => void {
        return pendingTasks.add();
      }
      const done = waitForTheFirstMessage();
      let events = await read({since, types: ['task_added']});
      const [added] = ofType(events, 'task_added');
      expect(added).toEqual(
        jasmine.objectContaining({
          source: 'PendingTasks',
          addedBy: jasmine.stringContaining('waitForTheFirstMessage'),
          appWasStable: true,
          app: jasmine.any(Number),
        }),
      );
      expect(added.stack.length).toBeGreaterThan(0);

      done();
      await fixture.whenStable();

      events = await read({since, types: ['task_removed']});
      const removed = ofType(events, 'task_removed').find((event) => event.task === added.task)!;
      expect(removed).toEqual(jasmine.objectContaining({added: added.seq, app: added.app}));
      // Removing a task schedules a render, which is a pending task too, so the application became
      // stable when the last of them was removed.
      expect(ofType(events, 'task_removed').some((event) => event.appStable)).toBeTrue();
    });

    // TestBed replaces the internal error handler, so this test bootstraps a real application.
    it(
      'should record an error reaching the ErrorHandler, with what was running',
      withBody('<el-broken></el-broken>', async () => {
        @Component({selector: 'el-broken', template: '<button (click)="fail()">go</button>'})
        class ElBroken {
          fail(): void {
            throw new Error('button failed');
          }
        }
        destroyPlatform();
        const appRef = await bootstrapApplication(ElBroken, {
          providers: [
            provideZonelessChangeDetection(),
            {provide: ErrorHandler, useValue: {handleError() {}}},
          ],
        });
        try {
          await appRef.whenStable();
          since = log().latestSeq;

          document.querySelector('button')!.click();

          const events = await read({since});
          const [listener] = ofType(events, 'listener');
          const [error] = ofType(events, 'error');
          expect(error).toEqual(
            jasmine.objectContaining({
              name: 'Error',
              message: 'button failed',
              listener: listener.seq,
            }),
          );
          expect(error.stack.length).toBeGreaterThan(0);
        } finally {
          destroyPlatform();
        }
      }),
    );
  });

  describe('installation', () => {
    it(
      'should start with the platform, in time for the first task of the application',
      withBody('<el-started></el-started>', async () => {
        @Component({selector: 'el-started', template: ''})
        class ElStarted {}
        destroyPlatform();
        uninstallEventLog();

        // What runs before Angular starts is not recorded.
        signal(0, {debugName: 'early'}).set(1);
        expect(getEventLog()).toBeNull();

        const appRef = await bootstrapApplication(ElStarted, {
          providers: [provideZonelessChangeDetection()],
        });
        try {
          await appRef.whenStable();
          const removed = ofType(await read({types: ['task_removed']}), 'task_removed');
          expect(removed.length).toBeGreaterThan(0);
          expect(removed.filter((event) => event.added === null)).toEqual([]);
        } finally {
          destroyPlatform();
        }
      }),
    );

    it('should not start the log itself when it is read', async () => {
      uninstallEventLog();

      const result = await eventsTool.execute({});

      expect(getEventLog()).toBeNull();
      expect(result.note).toContain('not available');
    });
  });

  describe('what added a pending task', () => {
    // Frames as a dev server reports them: Angular is bundled into files with hashed names, which
    // say nothing about what is in them.
    const CORE = 'http://localhost:4200/deps/core-B5CPxOQO.js:15837:34';
    const CHUNK = 'http://localhost:4200/deps/_resource-chunk-B-u9xlIb.js:4798:16';
    const APP = 'http://localhost:4200/main.js:52:10';

    function classify(...frames: string[]) {
      const stack = ['Error', ...frames.map((frame) => `    at ${frame}`)].join('\n');
      return classifyPendingTask(parseStack({stack} as Error));
    }

    it('should tell the task the scheduler adds after a tick', () => {
      expect(
        classify(
          `captureStack (${CHUNK})`,
          `EventLog.onPendingTaskAdded (${CHUNK})`,
          `PendingTasksInternal.add (${CHUNK})`,
          `Object.next (${CORE})`,
          `ConsumerObserver.next (${CHUNK})`,
          `Subject.next (${CHUNK})`,
          `ApplicationRef.tickImpl (${CORE})`,
          `NoopNgZone.run (${CHUNK})`,
          `ChangeDetectionSchedulerImpl.tick (${CORE})`,
        ),
      ).toEqual({source: 'change detection', addedBy: 'Object.next'});
    });

    it('should tell the task the scheduler adds from an anonymous function', () => {
      expect(
        classify(
          `PendingTasksInternal.add (${CHUNK})`,
          CORE,
          `NoopNgZone.runOutsideAngular (${CHUNK})`,
          `ChangeDetectionSchedulerImpl.switchToMicrotaskScheduler (${CORE})`,
        ).source,
      ).toBe('change detection');
    });

    it('should not take a task a library adds during a tick for one of Angular', () => {
      expect(
        classify(
          `PendingTasksInternal.add (${CHUNK})`,
          `PendingTasks.add (${CHUNK})`,
          `ExampleClient.connect (${APP})`,
          `ApplicationRef.tickImpl (${CORE})`,
          `ChangeDetectionSchedulerImpl.tick (${CORE})`,
        ),
      ).toEqual({source: 'PendingTasks', addedBy: 'ExampleClient.connect'});
    });

    it('should not take a task added from an anonymous function during a tick for one of Angular', () => {
      expect(
        classify(
          `PendingTasksInternal.add (${CHUNK})`,
          `PendingTasks.add (${CHUNK})`,
          `PendingTasks.run (${CHUNK})`,
          APP,
          `ChangeDetectionSchedulerImpl.tick (${CORE})`,
        ).source,
      ).toBe('PendingTasks');
    });

    // Firefox and Safari name methods without their class, which is then read from the script.
    function classifyWithoutClasses(...frames: Array<[string, string | null]>) {
      const stack = frames.map(([frame]) => frame).join('\n');
      return classifyPendingTask(
        parseStack({stack} as Error).map((frame, i) => withClassName(frame, frames[i][1])),
      );
    }

    it('should tell the task the scheduler adds from frames without class names', () => {
      expect(
        classifyWithoutClasses(
          [`captureStack@${CHUNK}`, null],
          [`onPendingTaskAdded@${CHUNK}`, 'EventLog'],
          [`add@${CHUNK}`, 'PendingTasksInternal'],
          [`notify@${CORE}`, 'ChangeDetectionSchedulerImpl'],
          [`markViewDirty@${CORE}`, null],
        ),
      ).toEqual({source: 'change detection', addedBy: 'ChangeDetectionSchedulerImpl.notify'});
    });

    it('should tell a task a library adds from frames without class names', () => {
      expect(
        classifyWithoutClasses(
          [`captureStack@${CHUNK}`, null],
          [`onPendingTaskAdded@${CHUNK}`, 'EventLog'],
          [`add@${CHUNK}`, 'PendingTasksInternal'],
          [`add@${CHUNK}`, 'PendingTasks'],
          [`connect@${APP}`, 'ExampleClient'],
          [`tick@${CORE}`, 'ChangeDetectionSchedulerImpl'],
        ),
      ).toEqual({source: 'PendingTasks', addedBy: 'ExampleClient.connect'});
    });

    it('should tell the task a @defer block adds to load its dependencies', () => {
      expect(
        classify(
          `PendingTasksInternal.add (${CHUNK})`,
          `PendingTasks.add (${CHUNK})`,
          `triggerResourceLoading (${CORE})`,
        ).source,
      ).toBe('@defer');
    });
  });

  describe('retention', () => {
    it('should hold no signal, effect, view or element strongly', async () => {
      const fixture = await render();
      const session = TestBed.inject(ElSession);
      since = log().latestSeq;

      session.user.set({id: 3, name: 'Cy'});
      fixture.componentInstance.showChild.set(true);
      await fixture.whenStable();
      (fixture.nativeElement as HTMLElement).querySelector('button')!.click();
      await fixture.whenStable();

      const stored = log()
        .read()
        .filter((event) => event.seq > since);
      expect(stored.length).toBeGreaterThan(5);
      const write = stored.find((event) => event.type === 'write') as StoredSignalWrite;
      expect(write.signal.ref).toBeInstanceOf(WeakRef);
      const run = stored.find((event) => event.type === 'effect') as StoredEffectRun;
      expect(run.effect.ref).toBeInstanceOf(WeakRef);
      expect(Object.keys(run.effect)).not.toContain('view');
      for (const event of stored) {
        expectNoStrongReference(event, event.type);
      }
    });
  });

  describe('size', () => {
    afterEach(() => {
      eventBufferSizeTool.execute({size: 100});
    });

    it('should drop the oldest events once full, and say so', async () => {
      const loose = signal(0, {debugName: 'loose'});
      // An event before `since`, which is 0 otherwise when this spec runs first: "since" 0 reads
      // the whole log, which then has nothing to say about the events it no longer keeps.
      loose.set(0);
      const before = await eventBufferSizeTool.execute({size: 10});
      expect(before).toEqual(jasmine.objectContaining({capacity: 10, previousCapacity: 100}));
      since = log().latestSeq;

      for (let i = 1; i <= 15; i++) loose.set(i);

      const result = await eventsTool.execute({since, types: ['write']});
      expect(result.capacity).toBe(10);
      expect(result.size).toBe(10);
      expect(result.oldestSeq).toBe(since + 6);
      expect(result.latestSeq).toBe(since + 15);
      expect(result.matched).toBe(10);
      expect(seqsOf(result.timeline)).toEqual(
        [6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((i) => since + i),
      );
      expect(result.timeline[0]).toMatch(new RegExp(`^${since + 6} @\\d+ms write loose 5->6$`));
      expect(result.note).toContain(`5 events after seq ${since} are no longer kept`);
    });

    it('should keep every event when growing and drop the oldest when shrinking', async () => {
      const loose = signal(0, {debugName: 'loose'});
      await eventBufferSizeTool.execute({size: 10});
      for (let i = 1; i <= 10; i++) loose.set(i);
      const {dropped} = log().status();

      const grown = await eventBufferSizeTool.execute({size: 50});
      expect(grown).toEqual(
        jasmine.objectContaining({capacity: 50, previousCapacity: 10, size: 10, dropped}),
      );
      for (let i = 11; i <= 15; i++) loose.set(i);
      expect(log().status().size).toBe(15);

      const shrunk = await eventBufferSizeTool.execute({size: 12});
      expect(shrunk).toEqual(
        jasmine.objectContaining({
          capacity: 12,
          previousCapacity: 50,
          size: 12,
          dropped: dropped + 3,
        }),
      );
      const events = await read({types: ['write']});
      expect((events[0] as {to: unknown}).to).toBe(4);
      expect(shrunk.oldestSeq).toBe(events[0].seq);
    });

    it('should keep the size for the tab across a reload', async () => {
      const storage = new Map<string, string>();
      const sessionStorageDescriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        'sessionStorage',
      );
      Object.defineProperty(globalThis, 'sessionStorage', {
        configurable: true,
        value: {
          getItem: (key: string) => storage.get(key) ?? null,
          setItem: (key: string, value: string) => void storage.set(key, value),
          removeItem: (key: string) => void storage.delete(key),
        },
      });
      try {
        const set = await eventBufferSizeTool.execute({size: 250});
        expect(set).toEqual(jasmine.objectContaining({capacity: 250, persisted: true}));
        expect(storage.get('ngEventLogCapacity')).toBe('250');
        const latest = log().latestSeq;

        // A reload installs a new log, which reads the stored size.
        uninstallEventLog();
        installEventLog();

        expect(log().status()).toEqual(jasmine.objectContaining({capacity: 250, size: 0}));
        // Sequence numbers belong to the page, so a `seq` from before still marks a point in time.
        signal(0, {debugName: 'loose'}).set(1);
        expect(log().latestSeq).toBe(latest + 1);

        await eventBufferSizeTool.execute({size: 100});
        expect(storage.has('ngEventLogCapacity')).toBeFalse();
      } finally {
        if (sessionStorageDescriptor === undefined) {
          delete (globalThis as {sessionStorage?: unknown}).sessionStorage;
        } else {
          Object.defineProperty(globalThis, 'sessionStorage', sessionStorageDescriptor);
        }
      }
    });

    it('should say when storage is unavailable', async () => {
      const sessionStorageDescriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        'sessionStorage',
      );
      Object.defineProperty(globalThis, 'sessionStorage', {
        configurable: true,
        get: () => {
          throw new Error('SecurityError');
        },
      });
      try {
        expect(await eventBufferSizeTool.execute({size: 20})).toEqual(
          jasmine.objectContaining({capacity: 20, persisted: false}),
        );
      } finally {
        if (sessionStorageDescriptor === undefined) {
          delete (globalThis as {sessionStorage?: unknown}).sessionStorage;
        } else {
          Object.defineProperty(globalThis, 'sessionStorage', sessionStorageDescriptor);
        }
      }
    });
  });

  describe('reading', () => {
    it('should show when an event happened, the same whatever the filter', async () => {
      const timed = signal(0, {debugName: 'timed'});
      timed.set(1);
      since = log().latestSeq;

      timed.set(2);
      const seq = log().latestSeq;

      const {details} = await eventsTool.execute({details: [seq]});
      const line = `${seq} @${details![0].atMs}ms write timed 1->2`;
      expect((await eventsTool.execute({since})).timeline).toEqual([line]);
      expect((await eventsTool.execute({causesOf: seq})).timeline).toEqual([line]);
    });

    it('should show one line per event, with its causes, and the details only when asked', async () => {
      const fixture = await render();
      const store = TestBed.inject(ElStore);
      const session = TestBed.inject(ElSession);
      store.tab.set('billing');
      await fixture.whenStable();
      since = log().latestSeq;

      (fixture.nativeElement as HTMLElement).querySelector('button')!.click();
      await fixture.whenStable();
      session.user.set({id: 2, name: 'Bob'});
      await fixture.whenStable();

      const result = await eventsTool.execute({since, types: ['listener', 'write', 'effect']});
      expect(result.details).toBeUndefined();
      const [listener, click, userWrite, run, reset] = result.timeline;
      const seq = seqsOf(result.timeline);
      expect(seq.length).toBe(5);
      expect(listener).toMatch(new RegExp(`^${seq[0]} @\\d+ms listener ElTabs click on button$`));
      expect(click).toMatch(
        new RegExp(`^${seq[1]} @\\d+ms write ElStore.tab 'billing'->'billing' = <-${seq[0]}$`),
      );
      expect(userWrite).toMatch(
        new RegExp(
          `^${seq[2]} @\\d+ms write ElSession.user \\{id:1,name:'Ada'\\}->\\{id:2,name:'Bob'\\}$`,
        ),
      );
      // A root effect has no owning component, so the start of its source names it.
      expect(run).toMatch(
        new RegExp(
          `^${seq[3]} @\\d+ms effect \\(\\) => \\{ this\\.session\\.user\\(\\); untracked\\(… <-${seq[2]}$`,
        ),
      );
      expect(reset).toMatch(
        new RegExp(`^${seq[4]} @\\d+ms write ElStore.tab 'billing'->'general' <-${seq[3]}$`),
      );
      expect(result.note).toBeUndefined();

      const cycles = await eventsTool.execute({since, types: ['cycle']});
      expect(cycles.timeline[0]).toMatch(
        new RegExp(`^\\d+ @\\d+ms cycle checked 1 refreshed 1 changed 0 [\\d.]+ms <-${seq[0]}$`),
      );

      const {details} = await eventsTool.execute({details: [seq[4], seq[3], 999999]});
      expect(details!.map((event) => event.seq)).toEqual([seq[4], seq[3]]);
      expect(details![0]).toEqual(
        jasmine.objectContaining({
          type: 'write',
          from: 'billing',
          to: 'general',
          context: 'effect',
        }),
      );
    });

    it('should filter by type, by name and by "since", and keep the newest when "limit" cuts', async () => {
      const loose = signal(0, {debugName: 'loose'});
      const fixture = await render();
      since = log().latestSeq;

      loose.set(1);
      fixture.componentInstance.count.set(1);
      await fixture.whenStable();
      loose.set(2);

      const all = await eventsTool.execute({since});
      const types = all.timeline.map((line) => line.split(' ')[2]);
      // The tasks of Angular's own render scheduling are left out unless asked for.
      expect(all.timeline.some((line) => line.includes('task_added change detection'))).toBeFalse();
      expect(types.filter((type) => !type.startsWith('task'))).toEqual([
        'write',
        'write',
        'cycle',
        'write',
      ]);
      expect(seqsOf(all.timeline).every((seq) => seq > since)).toBeTrue();
      expect(all.matched).toBe(all.timeline.length);
      expect(all.note).toBeUndefined();
      const tasks = await eventsTool.execute({since, types: ['task_added']});
      expect(
        tasks.timeline.some((line) => line.includes('task_added change detection')),
      ).toBeTrue();

      const writes = await eventsTool.execute({since, types: ['write'], limit: 2});
      expect(writes.timeline.map((line) => line.split(' ').pop())).toEqual(['0->1', '1->2']);
      expect(writes).toEqual(jasmine.objectContaining({matched: 3, truncated: true}));
      expect(writes.note).toContain('Showing the newest 2 of 3');

      const named = await eventsTool.execute({since, match: 'eltabs.COUNT'});
      expect(named.timeline.length).toBe(1);
      expect(named.timeline[0]).toContain('write ElTabs.count 0->1');

      const cycles = await eventsTool.execute({since, types: ['cycle', 'listener']});
      expect(cycles.timeline.length).toBe(1);
      expect(cycles.timeline[0]).toContain(' cycle checked 1 refreshed 1 changed 1 [ElTabs] ');
    });

    it('should return the chain of events behind one event', async () => {
      const fixture = await render();
      const session = TestBed.inject(ElSession);
      TestBed.inject(ElStore).tab.set('billing');
      await fixture.whenStable();
      since = log().latestSeq;

      session.user.set({id: 2, name: 'Bob'});
      await fixture.whenStable();

      const all = await eventsTool.execute({since, types: ['write', 'effect']});
      const [userWrite, run, reset] = seqsOf(all.timeline);
      expect(all.timeline.length).toBe(3);
      expect((await eventsTool.execute({since})).timeline.length).toBeGreaterThan(3);

      const chain = await eventsTool.execute({causesOf: reset});
      expect(seqsOf(chain.timeline)).toEqual([userWrite, run, reset]);
      expect(chain.matched).toBe(3);

      const gone = await eventsTool.execute({causesOf: 999999});
      expect(gone.timeline).toEqual([]);
      expect(gone.note).toContain('No event has seq 999999');
    });

    it('should tell when "since" is later than any event', async () => {
      const result = await eventsTool.execute({since: log().latestSeq + 1000});

      expect(result.timeline).toEqual([]);
      expect(result.note).toContain('later than any event on this page');
    });

    it('should reject invalid input', async () => {
      await expectAsync(eventsTool.execute({types: ['clicks' as 'cycle']})).toBeRejectedWithError(
        /"types" must be an array of write, effect, listener/,
      );
      await expectAsync(eventsTool.execute({match: 1 as unknown as string})).toBeRejectedWithError(
        'Invalid input: "match" must be a string.',
      );
      await expectAsync(eventsTool.execute({causesOf: 0})).toBeRejectedWithError(
        'Invalid input: "causesOf" must be a positive integer.',
      );
      await expectAsync(eventsTool.execute({details: [0]})).toBeRejectedWithError(
        'Invalid input: "details" must be an array of up to 50 positive integers.',
      );
      await expectAsync(eventsTool.execute({since: -1})).toBeRejectedWithError(
        'Invalid input: "since" must be a non-negative integer.',
      );
      await expectAsync(eventsTool.execute({limit: 0})).toBeRejectedWithError(
        'Invalid input: "limit" must be an integer from 1 to 1000.',
      );
      await expectAsync(eventBufferSizeTool.execute({size: 5})).toBeRejectedWithError(
        'Invalid input: "size" must be an integer from 10 to 20000.',
      );
      await expectAsync(eventBufferSizeTool.execute({size: 1.5})).toBeRejectedWithError(
        'Invalid input: "size" must be an integer from 10 to 20000.',
      );
    });

    it('should be named angular:events and angular:event_buffer_size', () => {
      expect(eventsTool.name).toBe('angular:events');
      expect(eventBufferSizeTool.name).toBe('angular:event_buffer_size');
    });
  });
});

/**
 * Checks that a stored event holds nothing of the application: no reactive node, view, element,
 * component or function, apart from weak references and the stacks of errors.
 */
function expectNoStrongReference(value: unknown, path: string, seen = new Set<object>()): void {
  if (typeof value === 'function') fail(`${path} holds a function`);
  if (typeof value !== 'object' || value === null || seen.has(value)) return;
  seen.add(value);
  if (value instanceof WeakRef || value instanceof Error) return;
  if ('producers' in value && 'consumers' in value) fail(`${path} holds a reactive node`);
  if (Array.isArray(value) && value.length > 25) fail(`${path} holds a view`);
  if (typeof Node !== 'undefined' && value instanceof Node) fail(`${path} holds a DOM node`);
  const proto = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.prototype && proto !== Array.prototype) {
    fail(`${path} holds a ${proto.constructor?.name ?? 'class instance'}`);
  }
  for (const [key, child] of Object.entries(value)) {
    expectNoStrongReference(child, `${path}.${key}`, seen);
  }
}
