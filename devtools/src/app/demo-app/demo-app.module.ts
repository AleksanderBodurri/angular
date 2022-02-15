/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {CUSTOM_ELEMENTS_SCHEMA, Injector, NgModule} from '@angular/core';
import {createCustomElement} from '@angular/elements';
import {RouterModule} from '@angular/router';
import {initializeMessageBus} from 'ng-devtools-backend';

import {ZoneUnawareIFrameMessageBus} from '../../zone-unaware-iframe-message-bus';

import {DemoAppComponent} from './demo-app.component';
import {HeavyComponent} from './heavy.component';
import {ProvidedInDemoAppModule, ProvidedInModule4} from './todo/app-todo.component';
import {ZippyComponent} from './zippy.component';



@NgModule({})
export class Module5 {
}

@NgModule({
  imports: [Module5],
  providers: [ProvidedInModule4],
})
export class Module4 {
}

@NgModule({imports: [Module4]})
export class Module2 {
}

@NgModule({imports: [Module4]})
export class Module3 {
}

@NgModule({imports: [Module2, Module3]})
export class Module1 {
}

@NgModule({
  providers: [ProvidedInDemoAppModule],
  declarations: [DemoAppComponent, HeavyComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  exports: [DemoAppComponent],
  imports: [
    Module1,
    RouterModule.forChild([
      {
        path: '',
        component: DemoAppComponent,
        children: [
          {
            path: '',
            loadChildren: () => import('./todo/app.module').then((m) => m.TodoAppModule),
          },
        ],
      },
    ]),
  ],
})
export class DemoAppModule {
  constructor(injector: Injector) {
    const el = createCustomElement(ZippyComponent, {injector});
    customElements.define('app-zippy', el as any);
    (window as any).DemoAppModule = DemoAppModule;
  }
}

initializeMessageBus(new ZoneUnawareIFrameMessageBus(
    'angular-devtools-backend', 'angular-devtools', () => window.parent));
