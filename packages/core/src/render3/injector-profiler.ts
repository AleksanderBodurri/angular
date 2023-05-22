/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {getDebugInjectContext} from '../di/inject_switch';
import {InjectionToken} from '../di/injection_token';
import {Injector} from '../di/injector';
import {InjectFlags, InjectOptions} from '../di/interface/injector';
import {Type} from '../interface/type';

import {DebugNodeInjector, NodeInjector} from './di';
import {LView} from './interfaces/view';
import { SingleProvider, walkProviderTree } from '../di/provider_collection';
import { NgModuleRef as viewEngine_NgModuleRef } from '../linker/ng_module_factory';
import { getInjectorDef } from '../di/interface/defs';
import { deepForEach } from '../util/array_utils';
import { isStandalone } from './definition';
import { EnvironmentInjector } from '../di/r3_injector';

export const enum InjectorProfilerEventType {
  /**
   * Emits when a service is injected.
   */
  Inject,

  /**
   * Emits when an Angular class instance is created.
   */
  Create,

  /**
   * Emits when an injector configures a provider.
   */
  ProviderConfigured
}

export interface InjectorProfilerContext {
  /**
   *  1. The Injector that service is being injected into.
   *      - Example: if ModuleA --provides--> ServiceA --injects--> ServiceB
   *                 then inject(ServiceB) in ServiceA has ModuleA as an injector context
   *  OR
   *
   *  2. LView of a view (acts as a standin because element injectors do not have a concrete
   * Injector instance)
   *      - Example: if ComponentA --injects--> ServiceA
   *                 then the inject(ServiceA) call would have the LView of the view
   *                 created by ComponentA an injector context
   */
  injector: Injector;

  /**
   *  The class where the constructor that is calling `inject` is located
   *      - Example: if ModuleA --provides--> ServiceA --injects--> ServiceB
   *                 then inject(ServiceB) in ServiceA has ServiceA as a construction context
   */
  token: Type<unknown>;
}

export interface InjectorProfilerEvent {
  type: InjectorProfilerEventType;
  data: InjectedService|ProviderRecord;
}

export interface ProviderRecord {
  /**
   * DI token that this provider is configuring
   */
  token: Type<unknown>;

  /**
   * The raw provider associated with this ProviderRecord.
   */
  provider?: SingleProvider;

  /**
   * The path of DI containers that were followed to import this provider
   */
  importPath?: Type<unknown>[]
}

export interface InjectedService {
  /**
   * DI token of the Service that is injected
   */
  token?: Type<unknown>;

  /**
   * Value of the injected service
   */
  value: unknown;

  /*
    Flags that this service was injected with
  */
  flags?: InjectFlags|InjectOptions;
}

export interface InjectorProfiler {
  (event: InjectorProfilerEvent): void;
}

let injectorProfilerCallback: InjectorProfiler|null = null;

export const setInjectorProfiler = (injectorProfiler: InjectorProfiler|null) => {
  injectorProfilerCallback = injectorProfiler;
};

export const injectorProfiler = function(injectorEvent: InjectorProfilerEvent): void {
  if (injectorProfilerCallback != null /* both `null` and `undefined` */) {
    injectorProfilerCallback!(injectorEvent);
  }
};


/**
 * 
 * @param injector An injector instance
 * @param token a DI token that was constructed by the given injector instance
 * @returns
 * an object that contains the created instance of token as well as all of the dependencies that it was instantiated with
 * OR
 * undefined if the token was not created within the given injector.
 * 
 */
export function getDependenciesFromInstantiation(injector: Injector, token: Type<unknown>): { instance: unknown; dependencies: InjectedService[] }|undefined {
  const NOT_FOUND = {};
  const instance = injector.get(token, NOT_FOUND, {self: true, optional: true});
  if (instance === NOT_FOUND) {
    return;
  }

  let injectorKey: Injector|LView = injector;
  if (injector instanceof NodeInjector) {
    injectorKey = new DebugNodeInjector(injector).lView;
  }

  let dependencies = injectorToInstantiatedTokenToDependencies.get(injectorKey)?.get?.(token) || [];
  dependencies = dependencies.map(
      dep => ({
        ...dep,
        providedIn: (typeof dep.value === 'object' ? instanceToInjector.get(dep.value!) :
                                                     instanceToInjector.get(dep.token!)) ||
            instanceToInjector.get(dep.token!)
      }));

  return {instance, dependencies};
}

export function getInjectorProviders(injector: Injector): ProviderRecord[] {
  let injectorKey: Injector|LView = injector;

  if (injector instanceof NodeInjector) {
    injectorKey = new DebugNodeInjector(injector).lView;
    return injectorToProviders.get(injectorKey) ?? [];
  } else if (injector instanceof DebugNodeInjector) {
    injectorKey = injector.lView;
    return injectorToProviders.get(injectorKey) ?? [];
  }

  // A DI container that configured providers. Either a standalone component constructor
  // or an NgModule constructor.
  let providerContainer: Type<unknown>;

  // standalone components configure providers through a component def, so we have to
  // use the standalone component associated with this injector if Injector represents
  // a standalone components EnvironmentInjector
  if (standaloneInjectorToComponent.has(injector)) {
    providerContainer = standaloneInjectorToComponent.get(injector)!;
  } 
  // Module injectors configure providers through their NgModule def, so we use the
  // injector to lookup its NgModuleRef and through that grab its instance
  else {
    const defTypeRef = injector.get(viewEngine_NgModuleRef, null, { self: true })!;
    const containerInstance = defTypeRef.instance ? defTypeRef.instance : defTypeRef;
    providerContainer = containerInstance.constructor;
  }

  let providerToPath = new Map<any, any[]>();
  let discoveredContainers = new Set();

  // Once we find the provider container for this injector, we can
  // use the walkProviderTree function to run a visitor on each node of the
  // provider tree. By keeping track of which providers we've already seen
  // during the traversal we can construct the path leading from the
  // provider container to the place where the provider was configured,
  // for each provider.
  walkProviderTree(providerContainer, (provider, container) => {
    if (!providerToPath.has(provider)) {
      providerToPath.set(provider, []);
    }
    
    if (!discoveredContainers.has(container)) {
      for (const prov of providerToPath.keys()) {
        const existingImportPath = providerToPath.get(prov)!;
        if (existingImportPath.length === 0) {
          continue
        }
        
        const containerDef = getInjectorDef(container)!;
        const firstContainerInPath = existingImportPath[0];

        let isNextStepInPath = false;

        deepForEach(containerDef.imports, (moduleImport) => {
          if (isNextStepInPath) {
            return;
          }
  
          isNextStepInPath = (moduleImport as any).ngModule === firstContainerInPath || moduleImport === firstContainerInPath;

          if (isNextStepInPath) {
            providerToPath.get(prov)?.unshift(container);
          }
        });
      }
    }

    providerToPath.get(provider)?.unshift(container);

    discoveredContainers.add(container);
  }, [], new Set());

  const providerRecords = injectorToProviders.get(injectorKey) ?? [];

  return providerRecords.map(providerRecord => {
    // We prepend the component constructor in the standalone case
    // because walkProviderTree does not visit this constructor during it's traversal
    if (isStandalone(providerContainer)) {
      const importPath = [providerContainer, ...providerToPath.get(providerRecord.provider) ?? []] ?? [providerContainer];
      return { ...providerRecord, importPath };
    }
    
    const importPath = providerToPath.get(providerRecord.provider) ?? [providerContainer];
    return { ...providerRecord, importPath };
  });
}

let injectorToInstantiatedTokenToDependencies =
    new WeakMap<Injector|LView, WeakMap<Type<unknown>, InjectedService[]>>();
let instanceToInjector = new WeakMap<object, Injector>();
let injectorToProviders = new WeakMap<Injector|LView, ProviderRecord[]>();
let standaloneInjectorToComponent = new WeakMap<Injector, Type<unknown>>();

export function setupFrameworkInjectorProfiler(): void {
  injectorToInstantiatedTokenToDependencies =
      new WeakMap<Injector|LView, WeakMap<Type<unknown>, InjectedService[]>>();
  instanceToInjector = new WeakMap<object, Injector>();
  injectorToProviders = new WeakMap<Injector|LView, ProviderRecord[]>();
  standaloneInjectorToComponent = new WeakMap<Injector, Type<unknown>>();;

  setInjectorProfiler(({data, type}: InjectorProfilerEvent) => {
    if (type === InjectorProfilerEventType.Inject) {
      const context = getDebugInjectContext();

      if (context === undefined || context.token === null) {
        return;
      }
  
      if (typeof context.token === 'string') {
        return  // Explicitly do not support string tokens
      }

      const {token, value, flags} = data as InjectedService;

      let injectorKey: Injector|LView = context.injector;

      if (context.injector instanceof DebugNodeInjector) {
        injectorKey = context.injector.lView!;
      }

      if (!injectorToInstantiatedTokenToDependencies.has(injectorKey)) {
        injectorToInstantiatedTokenToDependencies.set(
            injectorKey, new WeakMap<Type<unknown>, InjectedService[]>());
      }

      if (!injectorToInstantiatedTokenToDependencies.get(injectorKey)!.has(context.token)) {
        try {
          injectorToInstantiatedTokenToDependencies.get(injectorKey)!.set(context.token, []);
        } catch {
          throw new Error();
        }
      }

      injectorToInstantiatedTokenToDependencies.get(injectorKey)!.get(context.token)!.push(
          {token, value, flags});
    }

    if (type === InjectorProfilerEventType.Create) {
      const context = getDebugInjectContext();

      if (context === undefined || context.token === null) {
        return;
      }
  
      if (typeof context.token === 'string') {
        return  // Explicitly do not support string tokens
      }

      const {value} = data as InjectedService;

      if (value === null || value === undefined || !(value instanceof Object)) {
        if (context.token instanceof InjectionToken) {
          instanceToInjector.set(context.token, context.injector);
        }
        return;
      }

      if ((value as any).constructor as Type<unknown> && isStandalone((value as any).constructor as Type<unknown>)) {
        const environmentInjector = context.injector.get(EnvironmentInjector);
        standaloneInjectorToComponent.set(environmentInjector, (value as any).constructor as Type<unknown>);
      }

      instanceToInjector.set(value, context.injector);
    }

    if (type === InjectorProfilerEventType.ProviderConfigured) {
      const context = getDebugInjectContext();

      if (context === undefined || context.token === null) {
        return;
      }
  
      if (typeof context.token === 'string') {
        return  // Explicitly do not support string tokens
      }

      let injectorKey: Injector|LView = context.injector;

      if (context.injector instanceof DebugNodeInjector) {
        injectorKey = context.injector.lView;
      }

      if (!injectorToProviders.has(injectorKey)) {
        injectorToProviders.set(injectorKey, []);
      }

      injectorToProviders.get(injectorKey)!.push(data as ProviderRecord);
    }
  });
}
