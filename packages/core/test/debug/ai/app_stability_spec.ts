/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {Component, PendingTasks, signal} from '@angular/core';
import {ComponentFixture, TestBed} from '@angular/core/testing';
import {ApplicationStability, appStabilityTool} from '../../../src/debug/ai/app_stability';
import {getEventLog} from '../../../src/debug/ai/event_log';
import {eventBufferSizeTool} from '../../../src/debug/ai/event_log_tools';

@Component({selector: 'as-cmp', template: 'app'})
class AsCmp {}

/** Root elements attached to the document, as the tool looks at the applications on the page. */
const attached: HTMLElement[] = [];

async function render(): Promise<ComponentFixture<AsCmp>> {
  const fixture = TestBed.createComponent(AsCmp);
  document.body.appendChild(fixture.nativeElement);
  attached.push(fixture.nativeElement);
  await fixture.whenStable();
  return fixture;
}

async function stabilityOf(fixture: ComponentFixture<AsCmp>): Promise<ApplicationStability> {
  const {apps} = await appStabilityTool.execute({});
  const root = (fixture.nativeElement as HTMLElement).tagName.toLowerCase();
  return apps.find((app) => app.root === root)!;
}

describe('appStabilityTool', () => {
  afterEach(() => {
    attached.splice(0).forEach((element) => element.remove());
  });

  it('should report a stable application', async () => {
    const fixture = await render();

    const app = await stabilityOf(fixture);

    expect(app.stable).toBe(true);
    expect(app.pendingTasks).toEqual([]);
    expect(app.unstableForMs).toBeUndefined();
  });

  it('should tell which code keeps the application unstable', async () => {
    const fixture = await render();
    const pendingTasks = TestBed.inject(PendingTasks);
    let finish!: () => void;
    function waitForTheFirstMessage(): void {
      pendingTasks.run(() => new Promise<void>((resolve) => (finish = resolve)));
    }

    waitForTheFirstMessage();
    const app = await stabilityOf(fixture);

    expect(app.stable).toBe(false);
    expect(app.unstableForMs).toBeGreaterThanOrEqual(0);
    expect(app.pendingTasks).toEqual([
      jasmine.objectContaining({
        source: 'PendingTasks',
        addedBy: jasmine.stringContaining('waitForTheFirstMessage'),
      }),
    ]);
    expect(app.pendingTasks[0].ageMs).toBeGreaterThanOrEqual(0);
    expect(app.pendingTasks[0].stack.length).toBeGreaterThan(0);

    finish();
    await fixture.whenStable();
    expect((await stabilityOf(fixture)).stable).toBe(true);
  });

  it('should still tell where a task came from once the event log dropped its event', async () => {
    const fixture = await render();
    const pendingTasks = TestBed.inject(PendingTasks);
    function waitForTheReport(): () => void {
      return pendingTasks.add();
    }
    const done = waitForTheReport();
    await eventBufferSizeTool.execute({size: 10});
    try {
      const noise = signal(0, {debugName: 'noise'});
      for (let i = 1; i <= 20; i++) noise.set(i);
      expect(
        getEventLog()!
          .read()
          .some((event) => event.type === 'task_added'),
      ).toBe(false);

      const app = await stabilityOf(fixture);

      expect(app.pendingTasks).toEqual([
        jasmine.objectContaining({addedBy: jasmine.stringContaining('waitForTheReport')}),
      ]);
    } finally {
      done();
      await eventBufferSizeTool.execute({size: 100});
    }
  });

  it('should list the pending tasks oldest first and forget the removed ones', async () => {
    const fixture = await render();
    const pendingTasks = TestBed.inject(PendingTasks);

    const removeFirst = pendingTasks.add();
    const removeSecond = pendingTasks.add();
    removeFirst();
    const removeThird = pendingTasks.add();
    const app = await stabilityOf(fixture);

    // Removing a task schedules a render, which Angular also counts as a pending task.
    expect(app.pendingTasks.map((task) => task.source).sort()).toEqual([
      'PendingTasks',
      'PendingTasks',
      'change detection',
    ]);
    const added = app.pendingTasks.filter((task) => task.source === 'PendingTasks');
    expect(added[0].ageMs).toBeGreaterThanOrEqual(added[1].ageMs);

    removeSecond();
    removeThird();
    await fixture.whenStable();
    expect((await stabilityOf(fixture)).pendingTasks).toEqual([]);
  });
});
