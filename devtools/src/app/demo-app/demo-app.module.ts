/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {CUSTOM_ELEMENTS_SCHEMA, inject, Injector, NgModule, Pipe, PipeTransform} from '@angular/core';
import {createCustomElement} from '@angular/elements';
import {Router, RouterModule} from '@angular/router';
import {initializeMessageBus} from 'ng-devtools-backend';

import {ZoneUnawareIFrameMessageBus} from '../../zone-unaware-iframe-message-bus';

import {Car, DemoAppComponent, Engine, SomeService} from './demo-app.component';
import {HeavyComponent} from './heavy.component';
import {ProvidedInDemoAppModule, ProvidedInModule4} from './todo/app-todo.component';
import {ZippyComponent} from './zippy.component';

@Pipe({name: 'somePipe'})
export class SomePipe implements PipeTransform {
  router = inject(Router)

  transform(value: any, ...args: any[]): any {
    return value;
  }
}

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
  providers: [
    ProvidedInDemoAppModule, {provide: Engine, useClass: Engine}, {
      provide: Car,
      useFactory: () => {
        const engine = inject(Engine);

        return new Car(engine);
      }
    },
    SomeService
  ],
  declarations: [DemoAppComponent, HeavyComponent, SomePipe],
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
