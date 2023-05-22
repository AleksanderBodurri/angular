/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {inject} from '@angular/core';
import {ClassProvider, Component, destroyPlatform, FactoryProvider, InjectFlags, Injector, NgModule} from '@angular/core/src/core';
import {NullInjector} from '@angular/core/src/di/null_injector';
import { isClassProvider, isExistingProvider, isFactoryProvider, isTypeProvider, isValueProvider } from '@angular/core/src/di/provider_collection';
import {EnvironmentInjector, R3Injector} from '@angular/core/src/di/r3_injector';
import {getInjectorParent} from '@angular/core/src/render3/di';
import {getInjectorProviders, InjectedService, InjectorProfilerEvent, InjectorProfilerEventType, ProviderRecord, setInjectorProfiler, setupFrameworkInjectorProfiler} from '@angular/core/src/render3/injector-profiler';
import {TestBed, TestBedImpl} from '@angular/core/testing/src/test_bed';
import { bootstrapApplication, BrowserModule } from '@angular/platform-browser';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import { withBody } from '@angular/private/testing';

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

         expect(isTypeProvider((myServiceProviderConfiguredEvent?.data as ProviderRecord).provider!)).toBeTrue();
         expect(isFactoryProvider((myServiceBProviderConfiguredEvent?.data as ProviderRecord).provider!)).toBeTrue();
         expect(isExistingProvider((myServiceCProviderConfiguredEvent?.data as ProviderRecord).provider!)).toBeTrue();
         expect(isValueProvider((myServiceDProviderConfiguredEvent?.data as ProviderRecord).provider!)).toBeTrue();
         expect(isClassProvider((myServiceEProviderConfiguredEvent?.data as ProviderRecord).provider!)).toBeTrue();
       });

    it('should emit correct DI events when providers are configured with multi', () => {
      class MyService {}

      @Component({
        selector: 'my-comp',
        template: 'hello world',
        providers: [
          {provide: MyService, useClass: MyService, multi: true},
          {provide: MyService, useFactory: () => new MyService(), multi: true},
          {provide: MyService, useValue: 'hello world', multi: true}, 
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
      expect(((myServiceProviderConfiguredEvent?.data as ProviderRecord)?.provider as ClassProvider).multi).toBeTrue();
    });
  });

  describe('getInjectorParent', () => {
    beforeEach(() => setupFrameworkInjectorProfiler());
    afterAll(() => setInjectorProfiler(null));

    it('should be able to get the providers from a components injector', () => {
      class MyService {}
      @Component({
        selector: 'my-comp',
        template: 'hello world',
        providers: [
          MyService
        ]
      })
      class MyComponent {
      }
      TestBed.configureTestingModule({declarations: [MyComponent]});
      const fixture = TestBed.createComponent(MyComponent);

      const providers = getInjectorProviders(fixture.debugElement.injector);
      expect(providers.length).toBe(1);
      expect(providers[0].token).toBe(MyService);
      expect(providers[0].provider).toBe(MyService);
    });

    it('should be able to determine import paths after module provider flattening in the NgModule bootstrap case', 
      withBody('<my-comp></my-comp>', async () => {
      destroyPlatform();
  
      class MyService {}
      class MyServiceB {}
      
      @NgModule({
        providers: [MyService]
      })
      class ModuleA {}
      @NgModule({
        imports: [ModuleA],
      })
      class ModuleB {}
      
      @NgModule({
        providers: [MyServiceB]
      })
      class ModuleC {}

      @NgModule({
        imports: [ModuleB, ModuleC],
      })
      class ModuleD {}

      @Component({
        selector: 'my-comp',
        template: 'hello world',
      })
      class MyComponent {}

      @NgModule({
        imports: [ModuleD, BrowserModule],
        declarations: [MyComponent],
        bootstrap: [MyComponent],
      })
      class AppModule {}

      const ngModuleRef = await platformBrowserDynamic().bootstrapModule(AppModule);

      const appModuleInjector = ngModuleRef.injector;
      const providers = getInjectorProviders(appModuleInjector);

      const myServiceProvider = providers.find(provider => provider.token === MyService);
      const myServiceBProvider = providers.find(provider => provider.token === MyServiceB);
      
      expect(myServiceProvider).toBeTruthy();
      expect(myServiceBProvider).toBeTruthy();

      expect(myServiceProvider!.importPath).toBeInstanceOf(Array)
      expect(myServiceProvider!.importPath!.length).toBe(4);
      expect(myServiceProvider!.importPath![0]).toBe(AppModule);
      expect(myServiceProvider!.importPath![1]).toBe(ModuleD);
      expect(myServiceProvider!.importPath![2]).toBe(ModuleB);
      expect(myServiceProvider!.importPath![3]).toBe(ModuleA);

      expect(myServiceBProvider!.importPath).toBeInstanceOf(Array)
      expect(myServiceBProvider!.importPath!.length).toBe(3);
      expect(myServiceBProvider!.importPath![0]).toBe(AppModule);
      expect(myServiceBProvider!.importPath![1]).toBe(ModuleD);
      expect(myServiceBProvider!.importPath![2]).toBe(ModuleC);

      ngModuleRef.destroy();
      destroyPlatform();
    }));

    it('should be able to determine import paths after module provider flattening in the standalone component case', 
      withBody('<my-comp></my-comp>', async () => {
      destroyPlatform();
  
      class MyService {}
      class MyServiceB {}
      
      @NgModule({
        providers: [MyService]
      })
      class ModuleA {}
      @NgModule({
        imports: [ModuleA],
      })
      class ModuleB {}
      
      @NgModule({
        providers: [MyServiceB]
      })
      class ModuleC {}

      @NgModule({
        imports: [ModuleB, ModuleC],
      })
      class ModuleD {}

      @Component({
        selector: 'my-comp',
        template: 'hello world',
        imports: [ModuleD],
        standalone: true
      })
      class MyStandaloneComponent {
      }

      const applicationRef = await bootstrapApplication(MyStandaloneComponent);
      const appComponentEnvironmentInjector = applicationRef.components[0].injector.get(EnvironmentInjector);
      const providers = getInjectorProviders(appComponentEnvironmentInjector);

      const myServiceProvider = providers.find(provider => provider.token === MyService);
      const myServiceBProvider = providers.find(provider => provider.token === MyServiceB);
      
      expect(myServiceProvider).toBeTruthy();
      expect(myServiceBProvider).toBeTruthy();

      expect(myServiceProvider!.importPath).toBeInstanceOf(Array)
      expect(myServiceProvider!.importPath!.length).toBe(4);
      expect(myServiceProvider!.importPath![0]).toBe(MyStandaloneComponent);
      expect(myServiceProvider!.importPath![1]).toBe(ModuleD);
      expect(myServiceProvider!.importPath![2]).toBe(ModuleB);
      expect(myServiceProvider!.importPath![3]).toBe(ModuleA);

      expect(myServiceBProvider!.importPath).toBeInstanceOf(Array)
      expect(myServiceBProvider!.importPath!.length).toBe(3);
      expect(myServiceBProvider!.importPath![0]).toBe(MyStandaloneComponent);
      expect(myServiceBProvider!.importPath![1]).toBe(ModuleD);
      expect(myServiceBProvider!.importPath![2]).toBe(ModuleC);

      applicationRef.destroy();
      destroyPlatform();
    }));
  });

  describe('getInjectorParent', () => {
    beforeEach(() => setupFrameworkInjectorProfiler());
    afterAll(() => setInjectorProfiler(null));

    it('should be able to get the parent of an injector', () => {
      @Component({selector: 'my-comp', template: 'hello world'})
      class MyComponent {
      }
      TestBed.configureTestingModule({declarations: [MyComponent]});
      const fixture = TestBed.createComponent(MyComponent);

      expect(getInjectorParent(fixture.debugElement.injector)).toBe(TestBedImpl.inject(Injector))
    });

    it('should be able to able to climb the injector hierarchy to the NullInjector', () => {
      @Component({selector: 'my-comp', template: 'hello world'})
      class MyComponent {
      }
      TestBed.configureTestingModule({declarations: [MyComponent]});
      const fixture = TestBed.createComponent(MyComponent);

      // Pointer to an injector, we'll move this one with the getInjectorParent API
      let injector: Injector|null = fixture.debugElement.injector

      // Pointer to the parent of our injector above, we'll move this pointer
      // up the DI tree manually.
      let parentPointer = TestBedImpl.inject(Injector);

      expect(getInjectorParent(injector)).toBe(parentPointer);

      injector = getInjectorParent(injector);
      parentPointer = (parentPointer as R3Injector).parent;

      expect(injector).toBeTruthy();
      expect(parentPointer).toBeTruthy();
      expect(getInjectorParent(injector!)).toBe(parentPointer);

      injector = getInjectorParent(injector!);
      parentPointer = (parentPointer as R3Injector).parent;

      expect((injector as R3Injector).source).toBe('Platform: core');
      expect(parentPointer).toBeInstanceOf(NullInjector);
      expect(getInjectorParent(injector!)).toBe(parentPointer);

      injector = getInjectorParent(injector!);
      parentPointer = (parentPointer as R3Injector).parent;

      expect(injector).toBeInstanceOf(NullInjector);
      expect(parentPointer).toBeUndefined();

      injector = getInjectorParent(injector!);

      expect(injector).toBeNull();
    });
  });
});
