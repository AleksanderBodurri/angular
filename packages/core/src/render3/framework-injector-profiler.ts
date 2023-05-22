/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import { InjectionToken } from "../di/injection_token";
import { Injector } from "../di/injector";
import { getDebugInjectContext } from "../di/inject_switch";
import { EnvironmentInjector } from "../di/r3_injector";
import { Type } from "../interface/type";
import { isStandalone } from "./definition";
import { DebugNodeInjector } from "./di";
import { InjectedService, InjectorProfilerEvent, InjectorProfilerEventType, ProviderRecord, setInjectorProfiler } from "./injector-profiler";
import { LView } from "./interfaces/view";

 export const frameworkDIDebugData = {
    injectorToInstantiatedTokenToDependencies: new WeakMap<Injector|LView, WeakMap<Type<unknown>, InjectedService[]>>(),
    instanceToInjector: new WeakMap<object, Injector>(),
    injectorToProviders: new WeakMap<Injector|LView, ProviderRecord[]>(),
    standaloneInjectorToComponent: new WeakMap<Injector, Type<unknown>>()
  }
  
  export function setupFrameworkInjectorProfiler(): void {
    frameworkDIDebugData.injectorToInstantiatedTokenToDependencies =
        new WeakMap<Injector|LView, WeakMap<Type<unknown>, InjectedService[]>>();
    frameworkDIDebugData.instanceToInjector = new WeakMap<object, Injector>();
    frameworkDIDebugData.injectorToProviders = new WeakMap<Injector|LView, ProviderRecord[]>();
    frameworkDIDebugData.standaloneInjectorToComponent = new WeakMap<Injector, Type<unknown>>();;
  
    setInjectorProfiler(({data, type}: InjectorProfilerEvent) => {
      if (type === InjectorProfilerEventType.Inject) {
        const context = getDebugInjectContext();
  
        if (context === undefined || context.token === null) {
            return;
        }

        if (typeof context.token !== 'object' && typeof context.token !== 'function') {
            return;
        }
  
        const {token, value, flags} = data as InjectedService;
  
        let injectorKey: Injector|LView = context.injector;
  
        if (context.injector instanceof DebugNodeInjector) {
          injectorKey = context.injector.lView!;
        }
  
        if (!frameworkDIDebugData.injectorToInstantiatedTokenToDependencies.has(injectorKey)) {
          frameworkDIDebugData.injectorToInstantiatedTokenToDependencies.set(
              injectorKey, new WeakMap<Type<unknown>, InjectedService[]>());
        }
  
        if (!frameworkDIDebugData.injectorToInstantiatedTokenToDependencies.get(injectorKey)!.has(context.token)) {
          frameworkDIDebugData.injectorToInstantiatedTokenToDependencies.get(injectorKey)!.set(context.token, []);
        }
  
        frameworkDIDebugData.injectorToInstantiatedTokenToDependencies.get(injectorKey)!.get(context.token)!.push(
            {token, value, flags});
      }
  
      if (type === InjectorProfilerEventType.Create) {
        const context = getDebugInjectContext();
  
        if (context === undefined || context.token === null) {
          return;
        }
    
        if (typeof context.token !== 'object' && typeof context.token !== 'function') {
          return;
        }
  
        const {value} = data as InjectedService;
  
        if (value === null || value === undefined || !(value instanceof Object)) {
          if (context.token instanceof InjectionToken) {
            frameworkDIDebugData.instanceToInjector.set(context.token, context.injector);
          }
          return;
        }
  
        if ((value as any).constructor as Type<unknown> && isStandalone((value as any).constructor as Type<unknown>)) {
          const environmentInjector = context.injector.get(EnvironmentInjector);
          frameworkDIDebugData.standaloneInjectorToComponent.set(environmentInjector, (value as any).constructor as Type<unknown>);
        }
  
        frameworkDIDebugData.instanceToInjector.set(value, context.injector);
      }
  
      if (type === InjectorProfilerEventType.ProviderConfigured) {
        const context = getDebugInjectContext();

        let injectorKey: Injector|LView = context.injector;
  
        if (context.injector instanceof DebugNodeInjector) {
          injectorKey = context.injector.lView;
        }
  
        if (!frameworkDIDebugData.injectorToProviders.has(injectorKey)) {
          frameworkDIDebugData.injectorToProviders.set(injectorKey, []);
        }
  
        frameworkDIDebugData.injectorToProviders.get(injectorKey)!.push(data as ProviderRecord);
      }
    });
  }
  