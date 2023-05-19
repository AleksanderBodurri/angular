/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {inject} from '@angular/core';
import {Component, InjectFlags, Injector} from '@angular/core/src/core';
import {NullInjector} from '@angular/core/src/di/null_injector';
import {R3Injector} from '@angular/core/src/di/r3_injector';
import {getInjectorParent} from '@angular/core/src/render3/di';
import {InjectedService, InjectorProfilerEvent, InjectorProfilerEventType, ProviderRecord, setInjectorProfiler, setupFrameworkInjectorProfiler} from '@angular/core/src/render3/injector-profiler';
import {TestBed, TestBedImpl} from '@angular/core/testing/src/test_bed';

function searchForProfilerEvent(
    events: InjectorProfilerEvent[],
    condition: ((event: InjectorProfilerEvent) => boolean)): InjectorProfilerEvent|undefined {
  return events.find(event => condition(event));
}

describe('injector profiler', () => {
  describe('setProfiler', () => {
    let injectEvents: InjectorProfilerEvent[] = [];
    let createEvents: InjectorProfilerEvent[] = [];
    let providerConfiguredEvents: InjectorProfilerEvent[] = [];

    beforeEach(() => {
      injectEvents = [];
      createEvents = [];
      providerConfiguredEvents = [];

      setInjectorProfiler((({data, type}: InjectorProfilerEvent) => {
        if (type === InjectorProfilerEventType.Inject) {
          injectEvents.push({data, type});
        }
        if (type === InjectorProfilerEventType.Create) {
          createEvents.push({data, type});
        }
        if (type === InjectorProfilerEventType.ProviderConfigured) {
          providerConfiguredEvents.push({data, type});
        }
      }));
    });

    afterAll(() => setInjectorProfiler(null));

    it('should emit DI events when a component contains a provider and injects it', () => {
      class MyService {}

      @Component({
        selector: 'my-comp',
        template: 'hello world',
        providers: [
          MyService,
        ]
      })
      class MyComponent {
        myService = inject(MyService);
      }

      TestBed.configureTestingModule({declarations: [MyComponent]});
      const fixture = TestBed.createComponent(MyComponent);
      const myComp = fixture.componentInstance;

      // MyService should have been configured
      const myServiceProviderConfiguredEvent = searchForProfilerEvent(
          providerConfiguredEvents, (event) => event.data.token === MyService);
      expect(myServiceProviderConfiguredEvent).toBeTruthy();

      // inject(MyService) was called
      const myServiceInjectEvent =
          searchForProfilerEvent(injectEvents, (event) => event.data.token === MyService);
      expect(myServiceInjectEvent).toBeTruthy();
      expect((myServiceInjectEvent?.data as InjectedService).value).toBe(myComp.myService);
      expect((myServiceInjectEvent?.data as InjectedService).flags).toBe(InjectFlags.Default);

      // myComp is an angular instance that is able to call `inject` in it's constructor, so a
      // create event should have been emitted for it
      const componentCreateEvent = searchForProfilerEvent(
          createEvents, (event) => (event.data as InjectedService).value === myComp);
      expect(componentCreateEvent).toBeTruthy();
    });

    it('should emit the correct DI events when a service is injected with injection flags', () => {
      class MyService {}
      class MyServiceB {}
      class MyServiceC {}

      @Component({
        selector: 'my-comp',
        template: 'hello world',
        providers: [MyService, {provide: MyServiceB, useValue: 0}]
      })
      class MyComponent {
        myService = inject(MyService, {self: true});
        myServiceD = inject(MyServiceB, {skipSelf: true});
        myServiceC = inject(MyServiceC, {optional: true});
      }

      TestBed.configureTestingModule({
        providers: [MyServiceB, MyServiceC, {provide: MyServiceB, useValue: 1}],
        declarations: [MyComponent]
      });
      TestBed.createComponent(MyComponent);

      const myServiceInjectEvent =
          searchForProfilerEvent(injectEvents, (event) => event.data.token === MyService);
      const myServiceBInjectEvent =
          searchForProfilerEvent(injectEvents, (event) => event.data.token === MyServiceB);
      const myServiceCInjectEvent =
          searchForProfilerEvent(injectEvents, (event) => event.data.token === MyServiceC);

      expect((myServiceInjectEvent?.data as InjectedService).flags).toBe(InjectFlags.Self);
      expect((myServiceBInjectEvent?.data as InjectedService).flags).toBe(InjectFlags.SkipSelf);
      expect((myServiceBInjectEvent?.data as InjectedService).value).toBe(1);
      expect((myServiceCInjectEvent?.data as InjectedService).flags).toBe(InjectFlags.Optional);
    });

    it('should emit correct DI events when providers are configured with useFactory, useExisting, useClass, useValue',
       () => {
         class MyService {}
         class MyServiceB {}
         class MyServiceC {}
         class MyServiceD {}
         class MyServiceE {}

         @Component({
           selector: 'my-comp',
           template: 'hello world',
           providers: [
             MyService,
             {provide: MyServiceB, useFactory: () => new MyServiceB()},
             {provide: MyServiceC, useExisting: MyService},
             {provide: MyServiceD, useValue: 'hello world'},
             {provide: MyServiceE, useClass: class MyExampleClass {}},
           ]
         })
         class MyComponent {
           myService = inject(MyService);
         }

         TestBed.configureTestingModule({declarations: [MyComponent]});
         TestBed.createComponent(MyComponent);

         // MyService should have been configured
         const myServiceProviderConfiguredEvent = searchForProfilerEvent(
             providerConfiguredEvents, (event) => event.data.token === MyService);
         const myServiceBProviderConfiguredEvent = searchForProfilerEvent(
             providerConfiguredEvents, (event) => event.data.token === MyServiceB);
         const myServiceCProviderConfiguredEvent = searchForProfilerEvent(
             providerConfiguredEvents, (event) => event.data.token === MyServiceC);
         const myServiceDProviderConfiguredEvent = searchForProfilerEvent(
             providerConfiguredEvents, (event) => event.data.token === MyServiceD);
         const myServiceEProviderConfiguredEvent = searchForProfilerEvent(
             providerConfiguredEvents, (event) => event.data.token === MyServiceE);

         expect((myServiceProviderConfiguredEvent?.data as ProviderRecord).type).toBe('type');
         expect((myServiceBProviderConfiguredEvent?.data as ProviderRecord).type).toBe('factory');
         expect((myServiceCProviderConfiguredEvent?.data as ProviderRecord).type).toBe('existing');
         expect((myServiceDProviderConfiguredEvent?.data as ProviderRecord).type).toBe('value');
         expect((myServiceEProviderConfiguredEvent?.data as ProviderRecord).type).toBe('class');
       });

    it('should emit correct DI events when providers are configured with multi', () => {
      class MyService {}
      class MyServiceB {}

      @Component({
        selector: 'my-comp',
        template: 'hello world',
        providers: [
          {provide: MyService, useClass: MyService, multi: true},
          {provide: MyService, useFactory: () => new MyService(), multi: true},
          {provide: MyService, useValue: 'hello world', multi: true}, MyServiceB
        ]
      })
      class MyComponent {
        myService = inject(MyService);
      }

      TestBed.configureTestingModule({declarations: [MyComponent]});
      TestBed.createComponent(MyComponent);

      // MyService should have been configured
      const myServiceProviderConfiguredEvent = searchForProfilerEvent(
          providerConfiguredEvents, (event) => event.data.token === MyService);
      const myServiceBProviderConfiguredEvent = searchForProfilerEvent(
          providerConfiguredEvents, (event) => event.data.token === MyServiceB);

      expect((myServiceProviderConfiguredEvent?.data as ProviderRecord).multi).toBeTrue();
      expect((myServiceBProviderConfiguredEvent?.data as ProviderRecord).multi).toBeFalse();
    });
  });
});
