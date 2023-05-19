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
import {RElement} from './interfaces/renderer_dom';
import {LView} from './interfaces/view';

export const enum InjectorProfilerEventType {
  /**
   * Emits when a service is injected.
   */
  Inject,

  /**
   * Emits when an Angular class instance is created.
   */
  Create,

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
   *  1. The class where the constructor that is calling `inject` is located
   *      - Example: if ModuleA --provides--> ServiceA --injects--> ServiceB
   *                 then inject(ServiceB) in ServiceA has ServiceA as a construction context
   *  OR
   *
   *  2. The factory function that contains inject calls
   *      - Example: if ComponentA --injects--> ServiceA
   *                 then the inject(ServiceA) call has the factory function
   *                 of ComponentA as a construction context
   */
  token: Type<unknown>;
}

export interface InjectorProfilerEvent {
  type: InjectorProfilerEventType;
  data: InjectedService|ProviderRecord;
}

export interface ProviderRecord {
  token: Type<unknown>;
  type: 'value'|'factory'|'existing'|'type'|'class';
  multi: boolean;
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
 * For element injectors, we emit the `Inject` event when inject is called inside a factory
 * function, and a `Create` event when the factory function is done executing. It is only after the
 * create event fires that we can definitively determine that the factory function that triggered
 * that creation is the construction context for the services within it.
 *
 * Because of this, we buffer those initial `inject` events until a create event fires.
 *
 * This buffer stores groups of injected services by Injector context and construction context
 *
 * For example, lets say we have the following AppComponent
 *
 * export class AppComponent {
 *   router = inject(Router);
 *
 * }
 *
 * The order of events is as follows:
 * 1. Inject Event for the inject(Router) call:
 *        token: Router,
 *        value: Router instance,
 *        flags: InjectFlags.Default,
 *        context: {
 *          construction: AppComponentFactory,
 *          injector: LView of AppComponent
 *        }
 *
 * 2. buffer stores output of inject event by injector context (LView)
 *    and then by construction context (AppComponentFactory)
 *
 * 3. Create Event as AppComponentFactory resolves to construct AppComponent:
 *       value: AppComponent instance,
 *       context: {
 *         construction: AppComponentFactory,
 *         injector: LView of AppComponent
 *       }
 *
 * 4. buffer data is pulled out by using the injector context and
 *    construction context as keys for the buffer.
 */

// const buffer = new WeakMap<InjectorContext, Map<ConstructionContext, InjectedService[]>>();

// This map will be able to resolve any Angular class instance
// (component, directive, injector, service, pipe) into an array of its DI dependencies.
// let injectedInstanceToDependencies =
//     new WeakMap<InjectionToken<unknown>, InjectedService[]>();

export function getDependenciesFromInstantiation(injector: Injector, token: Type<unknown>): any {
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
  }

  return injectorToProviders.get(injectorKey) ?? [];
}

let injectorToInstantiatedTokenToDependencies =
    new WeakMap<Injector|LView, WeakMap<Type<unknown>, InjectedService[]>>();
let instanceToInjector = new WeakMap<object, Injector>();
let injectorToProviders = new Map<Injector|LView, ProviderRecord[]>();

export function setupFrameworkInjectorProfiler(): void {
  injectorToInstantiatedTokenToDependencies =
      new WeakMap<Injector|LView, WeakMap<Type<unknown>, InjectedService[]>>();
  instanceToInjector = new WeakMap<object, Injector>();
  injectorToProviders = new Map<Injector|LView, ProviderRecord[]>;

  setInjectorProfiler(({data, type}: InjectorProfilerEvent) => {
    const context = getDebugInjectContext();

    if (context === undefined || context.token === null) {
      return;
    }

    if (typeof context.token === 'string') {
      return  // Explicitly do not support string tokens
    }

    if (type === InjectorProfilerEventType.Inject) {
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
      const {value} = data as InjectedService;

      if (value === null || value === undefined || !(value instanceof Object)) {
        if (context.token instanceof InjectionToken) {
          instanceToInjector.set(context.token, context.injector);
        }
        return;
      }

      instanceToInjector.set(value, context.injector);
    }

    if (type === InjectorProfilerEventType.ProviderConfigured) {
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
