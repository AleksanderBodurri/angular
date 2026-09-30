/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {Component, computed, Directive, signal, ɵsetClassDebugInfo} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {getClassName} from '../../../src/debug/ai/shared/names';
import {serializeValue} from '../../../src/debug/ai/shared/serialize_value';
import {
  findEnclosingClass,
  parseStack,
  withClassName,
} from '../../../src/debug/ai/shared/stack_frames';
import {getComponentDef, getDirectiveDef} from '../../../src/render3/def_getters';

describe('shared helpers', () => {
  describe('serializeValue', () => {
    it('should return primitives as-is', () => {
      expect(serializeValue('hello')).toBe('hello');
      expect(serializeValue(42)).toBe(42);
      expect(serializeValue(true)).toBe(true);
      expect(serializeValue(null)).toBeNull();
      expect(serializeValue(undefined)).toBeUndefined();
    });

    it('should return bigints and symbols as strings', () => {
      expect(serializeValue(BigInt(10))).toBe('10n');
      expect(serializeValue(Symbol('tag'))).toBe('Symbol(tag)');
    });

    it('should cut strings longer than 200 characters', () => {
      expect(serializeValue('x'.repeat(250))).toBe('x'.repeat(200) + '…(+50 chars)');
    });

    it('should keep strings of exactly 200 characters', () => {
      expect(serializeValue('x'.repeat(200))).toBe('x'.repeat(200));
    });

    it('should cut long strings nested in objects', () => {
      expect(serializeValue({text: 'y'.repeat(201)})).toEqual({
        text: 'y'.repeat(200) + '…(+1 chars)',
      });
    });

    describe('depth', () => {
      it('should expand one level by default', () => {
        expect(serializeValue({a: {b: 1}, c: 2})).toEqual({a: 'Object {…}', c: 2});
      });

      it('should expand objects `depth` levels, then preview', () => {
        const value = {a: {b: 1}};

        expect(serializeValue(value, {depth: 1})).toEqual({a: 'Object {…}'});
        expect(serializeValue(value, {depth: 2})).toEqual({a: {b: 1}});
      });

      it('should preview everything but primitives at depth 0', () => {
        expect(serializeValue({a: 1}, {depth: 0})).toBe('Object {…}');
        expect(serializeValue([1, 2], {depth: 0})).toBe('Array(2)');
        expect(serializeValue('text', {depth: 0})).toBe('text');
      });

      it('should preview collections with their size', () => {
        expect(serializeValue(new Map([[1, 2]]), {depth: 0})).toBe('Map(1)');
        expect(serializeValue(new Set([1, 2]), {depth: 0})).toBe('Set(2)');
        expect(serializeValue(new Array(12).fill(0), {depth: 0})).toBe('Array(12)');
      });

      it('should preview class instances with their class name', () => {
        class UserProfile {
          name = 'Ada';
        }
        class _Underscored {}

        expect(serializeValue({user: new UserProfile()})).toEqual({user: 'UserProfile {…}'});
        expect(serializeValue(new UserProfile(), {depth: 0})).toBe('UserProfile {…}');
        expect(serializeValue(new _Underscored(), {depth: 0})).toBe('Underscored {…}');
        expect(serializeValue(Object.create(null), {depth: 0})).toBe('Object {…}');
      });

      it('should expand class instances as plain objects', () => {
        class UserProfile {
          name = 'Ada';
          age = 36;
        }

        expect(serializeValue(new UserProfile())).toEqual({name: 'Ada', age: 36});
      });

      it('should expand arrays', () => {
        expect(serializeValue([1, 'a', {b: 1}])).toEqual([1, 'a', 'Object {…}']);
        expect(serializeValue([[1, [2]]], {depth: 2})).toEqual([[1, 'Array(1)']]);
      });

      it('should expand Maps as entry lists and Sets as value lists', () => {
        expect(serializeValue(new Map([['k', 1]]))).toEqual({map: [['k', 1]]});
        expect(serializeValue(new Set([1, 2]))).toEqual({set: [1, 2]});
        expect(serializeValue(new Map([['k', {a: 1}]]))).toEqual({map: [['k', 'Object {…}']]});
      });

      it('should cap the depth at 5', () => {
        const value = {l1: {l2: {l3: {l4: {l5: {l6: {l7: 1}}}}}}};

        expect(serializeValue(value, {depth: 99})).toEqual({
          l1: {l2: {l3: {l4: {l5: 'Object {…}'}}}},
        });
      });

      it('should treat a negative depth as 0', () => {
        expect(serializeValue({a: 1}, {depth: -3})).toBe('Object {…}');
      });

      it('should use the default depth when it is not a finite number', () => {
        const value = {a: {b: 1}};

        for (const depth of ['abc', '2', {}, [], null, NaN, Infinity, -Infinity]) {
          expect(serializeValue(value, {depth: depth as unknown as number})).toEqual({
            a: 'Object {…}',
          });
        }
      });
    });

    describe('signals', () => {
      it('should read signals', () => {
        expect(serializeValue(signal(3))).toEqual({signal: 'signal', value: 3});
      });

      it('should report the kind of the reactive node', () => {
        const count = signal(2);

        expect(serializeValue(computed(() => count() * 2))).toEqual({signal: 'computed', value: 4});
      });

      it('should report the error of a computed that throws', () => {
        const failing = computed((): number => {
          throw new Error('boom');
        });

        expect(serializeValue(failing)).toEqual({signal: 'computed', error: 'boom'});
      });

      it('should report thrown non-errors', () => {
        const failing = computed((): number => {
          throw 'plain string';
        });

        expect(serializeValue(failing)).toEqual({signal: 'computed', error: 'plain string'});
      });

      it('should unwrap signals nested in objects', () => {
        expect(serializeValue({count: signal(1)})).toEqual({
          count: {signal: 'signal', value: 1},
        });
      });

      it('should not count the signal as a depth level', () => {
        expect(serializeValue(signal({a: {b: 1}}))).toEqual({
          signal: 'signal',
          value: {a: 'Object {…}'},
        });
        expect(serializeValue(signal({a: 1}), {depth: 0})).toEqual({
          signal: 'signal',
          value: 'Object {…}',
        });
      });

      it('should not loop on a signal that holds itself', () => {
        const self = signal<unknown>(null);
        self.set(self);

        expect(serializeValue(self)).toEqual({signal: 'signal', value: '[circular]'});
      });
    });

    describe('functions and DOM nodes', () => {
      it('should report functions by name', () => {
        function greet() {}
        class Service {}

        expect(serializeValue(greet)).toBe('ƒ greet()');
        expect(serializeValue(Service)).toBe('ƒ Service()');
        expect(serializeValue({onClick: greet})).toEqual({onClick: 'ƒ greet()'});
        expect(serializeValue((() => () => {})())).toBe('ƒ anonymous()');
      });

      it('should return DOM elements as the element', () => {
        const element = document.createElement('div');

        expect(serializeValue(element)).toBe(element);
        expect((serializeValue({host: element}) as {host: unknown}).host).toBe(element);
        expect(serializeValue(element, {depth: 0})).toBe(element);
      });

      it('should return other DOM nodes as the node', () => {
        const text = document.createTextNode('hi');

        expect(serializeValue(text)).toBe(text);
      });
    });

    describe('hostile values', () => {
      it('should replace cycles with a marker', () => {
        const value: {name: string; self?: unknown} = {name: 'a'};
        value.self = value;

        expect(serializeValue(value)).toEqual({name: 'a', self: '[circular]'});
      });

      it('should find cycles through arrays, Maps and Sets', () => {
        const array: unknown[] = [];
        array.push(array);
        const map = new Map<string, unknown>();
        map.set('self', map);
        const set = new Set<unknown>();
        set.add(set);

        expect(serializeValue(array, {depth: 3})).toEqual(['[circular]']);
        expect(serializeValue(map, {depth: 3})).toEqual({map: [['self', '[circular]']]});
        expect(serializeValue(set, {depth: 3})).toEqual({set: ['[circular]']});
      });

      it('should not mistake a shared reference for a cycle', () => {
        const shared = {n: 1};

        expect(serializeValue({a: shared, b: shared}, {depth: 2})).toEqual({
          a: {n: 1},
          b: {n: 1},
        });
      });

      it('should not call getters', () => {
        let calls = 0;
        const value = {
          ok: 1,
          get bad(): number {
            calls++;
            throw new Error('getter failed');
          },
          get fine(): number {
            calls++;
            return 2;
          },
        };

        expect(serializeValue(value)).toEqual({ok: 1, bad: '[getter]', fine: '[getter]'});
        expect(calls).toBe(0);
      });

      it('should not call accessors defined with `defineProperty`', () => {
        let calls = 0;
        const value = {};
        Object.defineProperty(value, 'setterOnly', {
          set() {
            calls++;
          },
          enumerable: true,
        });
        Object.defineProperty(value, 'hidden', {
          get() {
            calls++;
            return 1;
          },
          enumerable: false,
        });

        expect(serializeValue(value)).toEqual({setterOnly: '[getter]'});
        expect(calls).toBe(0);
      });

      it('should not call getters on array elements', () => {
        let calls = 0;
        const value = [1, 2];
        Object.defineProperty(value, 1, {
          get() {
            calls++;
            throw new Error('element failed');
          },
        });

        expect(serializeValue(value)).toEqual([1, '[getter]']);
        expect(calls).toBe(0);
      });

      it('should not throw when the value itself cannot be inspected', () => {
        const hostile = new Proxy(
          {},
          {
            ownKeys() {
              throw new Error('no keys for you');
            },
          },
        );

        expect(serializeValue(hostile)).toBe('[error: no keys for you]');
        expect(serializeValue({hostile}, {depth: 2})).toEqual({
          hostile: '[error: no keys for you]',
        });
      });

      it('should list at most 30 array entries', () => {
        const result = serializeValue(Array.from({length: 100}, (_, i) => i)) as unknown[];

        expect(result.length).toBe(31);
        expect(result.slice(0, 30)).toEqual(Array.from({length: 30}, (_, i) => i));
        expect(result[30]).toBe('…(+70 more)');
      });

      it('should list all entries of a collection of exactly 30', () => {
        const result = serializeValue(Array.from({length: 30}, (_, i) => i)) as unknown[];

        expect(result.length).toBe(30);
      });

      it('should cap a 10,000-item array', () => {
        const result = serializeValue(new Array(10_000).fill({a: 1})) as unknown[];

        expect(result.length).toBe(31);
        expect(result[30]).toBe('…(+9970 more)');
      });

      it('should list at most 30 object entries', () => {
        const value: Record<string, number> = {};
        for (let i = 0; i < 40; i++) value[`k${i}`] = i;

        const result = serializeValue(value) as Record<string, unknown>;

        expect(Object.keys(result).length).toBe(31);
        expect(result['k29']).toBe(29);
        expect(result['k30']).toBeUndefined();
        expect(result['…']).toBe('(+10 more)');
      });

      it('should list at most 30 Map and Set entries', () => {
        const map = new Map(Array.from({length: 35}, (_, i) => [i, i] as [number, number]));
        const set = new Set(Array.from({length: 33}, (_, i) => i));

        const mapEntries = (serializeValue(map) as {map: unknown[]}).map;
        const setValues = (serializeValue(set) as {set: unknown[]}).set;

        expect(mapEntries.length).toBe(31);
        expect(mapEntries[29]).toEqual([29, 29]);
        expect(mapEntries[30]).toBe('…(+5 more)');
        expect(setValues.length).toBe(31);
        expect(setValues[30]).toBe('…(+3 more)');
      });

      it('should cut long error messages', () => {
        const hostile = new Proxy(
          {},
          {
            ownKeys() {
              throw new Error('e'.repeat(300));
            },
          },
        );
        const failing = computed((): number => {
          throw new Error('f'.repeat(300));
        });

        expect(serializeValue(hostile)).toBe(`[error: ${'e'.repeat(200)}…(+100 chars)]`);
        expect(serializeValue(failing)).toEqual({
          signal: 'computed',
          error: 'f'.repeat(200) + '…(+100 chars)',
        });
      });
    });

    describe('built-in objects', () => {
      it('should report a Date as an ISO string', () => {
        const date = new Date(Date.UTC(2024, 0, 15, 10, 30));

        expect(serializeValue(date)).toBe('2024-01-15T10:30:00.000Z');
        expect(serializeValue(date, {depth: 0})).toBe('2024-01-15T10:30:00.000Z');
        expect(serializeValue({createdAt: date})).toEqual({createdAt: '2024-01-15T10:30:00.000Z'});
      });

      it('should report an invalid Date', () => {
        expect(serializeValue(new Date('not a date'))).toBe('Invalid Date');
      });

      it('should report a RegExp as its literal', () => {
        expect(serializeValue(/ab+c/gi)).toBe('/ab+c/gi');
        expect(serializeValue({pattern: /x/})).toEqual({pattern: '/x/'});
      });

      it('should report an Error as its name and message', () => {
        class CustomError extends Error {
          constructor(message: string) {
            super(message);
            this.name = 'CustomError';
          }
        }

        expect(serializeValue(new Error('bad'))).toBe('Error: bad');
        expect(serializeValue(new TypeError('worse'))).toBe('TypeError: worse');
        expect(serializeValue(new CustomError('custom'))).toBe('CustomError: custom');
        expect(serializeValue({error: new Error('nested')})).toEqual({error: 'Error: nested'});
      });

      it('should preview typed arrays without reading their elements', () => {
        expect(serializeValue(new Uint8Array(5))).toBe('Uint8Array(5)');
        expect(serializeValue({data: new Float64Array(3)})).toEqual({data: 'Float64Array(3)'});
        expect(serializeValue(new DataView(new ArrayBuffer(8)))).toBe('DataView(8)');
      });

      it('should answer instantly for a huge typed array', () => {
        const huge = new Uint8Array(5e7);

        const start = performance.now();
        const result = serializeValue(huge, {depth: 5});
        const elapsed = performance.now() - start;

        expect(result).toBe('Uint8Array(50000000)');
        expect(elapsed).toBeLessThan(1000);
      });

      it('should preview an ArrayBuffer by its byte length', () => {
        expect(serializeValue(new ArrayBuffer(16))).toBe('ArrayBuffer(16)');
      });

      it('should report a Promise by name', () => {
        expect(serializeValue(Promise.resolve(1))).toBe('Promise');
        expect(serializeValue({pending: new Promise(() => {})})).toEqual({pending: 'Promise'});
      });

      it('should report a WeakMap by name', () => {
        expect(serializeValue(new WeakMap())).toBe('WeakMap');
      });

      it('should report a WeakSet by name', () => {
        expect(serializeValue(new WeakSet())).toBe('WeakSet');
      });

      it('should not run application code to recognize built-ins', () => {
        let calls = 0;
        class Tagged {
          a = 1;
          get [Symbol.toStringTag]() {
            calls++;
            return 'Tagged';
          }
        }

        expect(serializeValue(new Tagged())).toEqual({a: 1});
        expect(calls).toBe(0);
      });
    });

    describe('node budget', () => {
      /** Counts the arrays, objects and signals which were expanded in a serialized result. */
      function countExpanded(result: unknown): number {
        if (Array.isArray(result)) {
          return 1 + result.reduce<number>((sum, item) => sum + countExpanded(item), 0);
        }
        if (typeof result === 'object' && result !== null) {
          const record = result as Record<string, unknown>;
          if ('signal' in record) return 1 + countExpanded(record['value']);
          return 1 + Object.values(record).reduce<number>((sum, v) => sum + countExpanded(v), 0);
        }
        return 0;
      }

      it('should expand at most 500 nodes in one call', () => {
        const cube = Array.from({length: 30}, () =>
          Array.from({length: 30}, () => Array.from({length: 30}, (_, i) => i)),
        );

        const start = performance.now();
        const result = serializeValue(cube, {depth: 5}) as unknown[][];
        const elapsed = performance.now() - start;

        expect(countExpanded(result)).toBe(500);
        expect(elapsed).toBeLessThan(1000);
        // Nodes are expanded depth first, so the budget runs out part way through the list.
        expect(result[0][0]).toEqual(Array.from({length: 30}, (_, i) => i));
        expect(result[29]).toBe('Array(30)');
      });

      it('should give every call its own budget', () => {
        const cube = Array.from({length: 30}, () =>
          Array.from({length: 30}, () => Array.from({length: 30}, (_, i) => i)),
        );

        expect(countExpanded(serializeValue(cube, {depth: 5}))).toBe(500);
        expect(countExpanded(serializeValue(cube, {depth: 5}))).toBe(500);
      });

      it('should count signals against the budget', () => {
        const rows = Array.from({length: 30}, () => Array.from({length: 30}, (_, i) => signal(i)));

        const result = serializeValue(rows, {depth: 5}) as unknown[][];

        expect(countExpanded(result)).toBe(500);
        // 1 array of rows, 16 full rows of 31 nodes each, then the budget ends inside row 16.
        expect(result[16][1]).toEqual({signal: 'signal', value: 1});
        expect(result[16][2]).toBe('signal {…}');
        expect(result[29]).toBe('Array(30)');
      });

      it('should still return primitives and DOM nodes once the budget is spent', () => {
        const element = document.createElement('div');
        const rows = Array.from({length: 30}, () =>
          Array.from({length: 30}, () => Array.from({length: 30}, () => [1])),
        );
        const value = {rows, text: 'after', element, count: 3};

        const result = serializeValue(value, {depth: 5}) as Record<string, unknown>;

        expect(result['text']).toBe('after');
        expect(result['count']).toBe(3);
        expect(result['element']).toBe(element);
      });
    });

    describe('framework internals', () => {
      it('should not list `__ngContext__`', async () => {
        @Component({selector: 'shared-helpers-patched', template: ''})
        class PatchedCmp {
          name = 'patched';
          items = [1, 2];
        }

        const fixture = TestBed.createComponent(PatchedCmp);
        await fixture.whenStable();
        // Guard against the test passing for the wrong reason: the framework patches instances.
        expect(Object.keys(fixture.componentInstance)).toContain('__ngContext__');

        expect(serializeValue(fixture.componentInstance, {depth: 2})).toEqual({
          name: 'patched',
          items: [1, 2],
        });
        expect(serializeValue({holder: fixture.componentInstance}, {depth: 3})).toEqual({
          holder: {name: 'patched', items: [1, 2]},
        });
      });

      it('should not count `__ngContext__` towards the entry limit', () => {
        const value: Record<string, number> = {};
        for (let i = 0; i < 30; i++) value[`k${i}`] = i;
        value['__ngContext__'] = 99;

        const result = serializeValue(value) as Record<string, unknown>;

        expect(Object.keys(result).length).toBe(30);
        expect(result['…']).toBeUndefined();
      });
    });
  });

  describe('names', () => {
    describe('getClassName', () => {
      it('should strip the bundler-added leading underscore', () => {
        @Component({selector: 'shared-helpers-underscored', template: ''})
        class _UnderscoredCmp {}

        @Directive({selector: '[sharedHelpersUnderscored]'})
        class _UnderscoredDir {}

        expect(getClassName(getComponentDef(_UnderscoredCmp)!)).toBe('UnderscoredCmp');
        expect(getClassName(getDirectiveDef(_UnderscoredDir)!)).toBe('UnderscoredDir');
      });

      it('should prefer the class name recorded in debug info', () => {
        @Component({selector: 'shared-helpers-debug-info', template: ''})
        class _DebugInfoCmp {}
        ɵsetClassDebugInfo(_DebugInfoCmp, {className: '_DebugInfoCmp'});

        expect(getClassName(getComponentDef(_DebugInfoCmp)!)).toBe('_DebugInfoCmp');
      });
    });
  });

  describe('stack frames', () => {
    const CORE = 'http://localhost:4200/deps/core-B5CPxOQO.js';
    const APP = 'http://localhost:4200/main.js';

    function parse(...lines: string[]) {
      return parseStack({stack: lines.join('\n')} as Error);
    }

    it('should read frames as Chrome reports them', () => {
      expect(
        parse(
          'Error',
          `    at PendingTasks.add (${CORE}:4110:44)`,
          `    at new _ReportsPage (${APP}:1684:14)`,
          `    at async CartStore.load (${APP}:40:3)`,
          `    at ${CORE}:2142:9`,
        ),
      ).toEqual([
        {fn: 'PendingTasks.add', url: CORE, line: 4110, column: 44},
        {fn: '_ReportsPage', url: APP, line: 1684, column: 14},
        {fn: 'CartStore.load', url: APP, line: 40, column: 3},
        {fn: null, url: CORE, line: 2142, column: 9},
      ]);
    });

    it('should read frames as Firefox reports them', () => {
      expect(
        parse(
          `add@${CORE}:4110:44`,
          `ConsumerObserver.prototype.next@${CORE}:10:5`,
          `switchToMicrotaskScheduler/<@${CORE}:120:7`,
          `setTimeout handler*poll@${APP}:3:1`,
          `@http://localhost:4200/@fs/app/deps/@angular_router.js:2142:9`,
          'evaluate@debugger eval code:1:1',
          '',
        ),
      ).toEqual([
        {fn: 'add', url: CORE, line: 4110, column: 44},
        {fn: 'ConsumerObserver.next', url: CORE, line: 10, column: 5},
        {fn: 'switchToMicrotaskScheduler/<', url: CORE, line: 120, column: 7},
        {fn: 'poll', url: APP, line: 3, column: 1},
        {
          fn: null,
          url: 'http://localhost:4200/@fs/app/deps/@angular_router.js',
          line: 2142,
          column: 9,
        },
      ]);
    });

    it('should read frames as Safari reports them', () => {
      expect(
        parse(
          `onPendingTaskAdded@${CORE}:10341:24`,
          `@${CORE}:2142:23`,
          'forEach@[native code]',
          `module code@${APP}:5:10`,
        ),
      ).toEqual([
        {fn: 'onPendingTaskAdded', url: CORE, line: 10341, column: 24},
        {fn: null, url: CORE, line: 2142, column: 23},
        {fn: null, url: APP, line: 5, column: 10},
      ]);
    });

    it('should read at most 40 frames, which Firefox captures more of', () => {
      const lines = Array.from({length: 60}, (_, i) => `frame${i}@${APP}:${i + 1}:1`);
      expect(parse(...lines).length).toBe(40);
    });

    describe('classes', () => {
      const script = [
        'var PendingTasks = class PendingTasks {',
        '\tadd() {',
        '\t\treturn this.internal.add();',
        '\t}',
        '};',
        'function bootstrap() {',
        '\treturn run();',
        '}',
        'class Scheduler extends Base {',
        '\tconstructor() {',
        '\t\tthis.subscriptions.add(',
        '',
        '\t\t\tthis.afterTick.subscribe(() => {',
        '\t\t\t\tthis.tasks.add();',
        '\t\t\t}),',
        '\t\t);',
        '\t}',
        '};',
        'var EventLog = class {',
        '\tonPendingTaskAdded(tasks) {',
        '\t\tcaptureStack();',
        '\t}',
        '};',
        'var Handler = class extends Base {',
        '\thandle() {',
        '\t\treturn next();',
        '\t}',
        '};',
        'function render(el) {',
        '\tif (el.class) {',
        '\t\treturn el.className;',
        '\t}',
        '}',
      ];

      it('should find the class around a line from its indentation', () => {
        expect(findEnclosingClass(script, 3)).toBe('PendingTasks');
        expect(findEnclosingClass(script, 14)).toBe('Scheduler');
      });

      it('should name a class expression without a name after its variable', () => {
        expect(findEnclosingClass(script, 21)).toBe('EventLog');
        expect(findEnclosingClass(script, 26)).toBe('Handler');
      });

      it('should not take a property named class for a class', () => {
        expect(findEnclosingClass(script, 31)).toBeNull();
      });

      it('should find no class around a function outside of any', () => {
        expect(findEnclosingClass(script, 7)).toBeNull();
        expect(findEnclosingClass(script, 1)).toBeNull();
      });

      it('should find no class in a script without indentation', () => {
        expect(findEnclosingClass(['class A{add(){return 1}}'], 1)).toBeNull();
      });

      it('should name the class of a method', () => {
        const frame = {url: CORE, line: 1, column: 1};
        expect(withClassName({...frame, fn: 'add'}, 'PendingTasks').fn).toBe('PendingTasks.add');
        expect(withClassName({...frame, fn: null}, 'Scheduler').fn).toBe('Scheduler.<anonymous>');
        expect(withClassName({...frame, fn: 'notify/<'}, 'Scheduler').fn).toBe(
          'Scheduler.notify/<',
        );
      });

      it('should keep names that already name their object or class', () => {
        const frame = {url: CORE, line: 1, column: 1};
        expect(withClassName({...frame, fn: 'Subject.next'}, 'Scheduler').fn).toBe('Subject.next');
        expect(withClassName({...frame, fn: 'Scheduler/<'}, 'Scheduler').fn).toBe('Scheduler/<');
        expect(withClassName({...frame, fn: 'Page<'}, 'Page').fn).toBe('Page<');
        expect(withClassName({...frame, fn: 'bootstrap'}, null).fn).toBe('bootstrap');
      });
    });
  });
});
