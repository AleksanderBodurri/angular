/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Injector} from '../di/injector';
import {InjectFlags, InjectOptions} from '../di/interface/injector';
import {Type} from '../interface/type';

import { SingleProvider } from '../di/provider_collection';

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
