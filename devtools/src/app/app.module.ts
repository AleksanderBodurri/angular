/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Component, Injectable, InjectionToken, ModuleWithProviders, NgModule} from '@angular/core';
import {BrowserAnimationsModule} from '@angular/platform-browser/animations';
import {RouterModule} from '@angular/router';
import {ApplicationEnvironment, ApplicationOperations} from 'ng-devtools';

import {DemoApplicationEnvironment} from '../demo-application-environment';
import {DemoApplicationOperations} from '../demo-application-operations';

import {AppComponent} from './app.component';

@Injectable()
class SomeFeatureService {
  constructor() {
    console.log(this)
  }
}

@Injectable()
class SomeFeatureService2 {
  constructor() {
    console.log(this);
  }
}

@Component({template: `<div>some component</div>`, selector: 'app-some-component'})
export class SomeComponent {
  constructor(
      private someFeatureService: SomeFeatureService,
      private someFeatureService2: SomeFeatureService2) {}
}

@NgModule({providers: [SomeFeatureService]})
export class SomeFeatureModule2 {
  static init(): ModuleWithProviders<SomeFeatureModule2> {
    return {
      ngModule: SomeFeatureModule2, providers: [SomeFeatureService2]
    }
  }
}

@NgModule({
  declarations: [SomeComponent],
  exports: [SomeComponent],
  imports: [SomeFeatureModule2.init()],
  providers: [SomeFeatureService]
})
export class SomeFeatureModule {
}

export const foo = new InjectionToken('foo');

@NgModule({
  declarations: [AppComponent],
  imports: [
    BrowserAnimationsModule, RouterModule.forRoot([
      {
        path: '',
        loadChildren: () =>
            import('./devtools-app/devtools-app.module').then((m) => m.DevToolsModule),
        pathMatch: 'full',
      },
      {
        path: 'demo-app',
        loadChildren: () => import('./demo-app/demo-app.module').then((m) => m.DemoAppModule),
      },
    ]),
    SomeFeatureModule
  ],
  providers: [
    {
      provide: ApplicationOperations,
      useClass: DemoApplicationOperations,
    },
    {
      provide: ApplicationEnvironment,
      useClass: DemoApplicationEnvironment,
    },
    {provide: foo, useValue: 'bar'}
  ],
  bootstrap: [AppComponent],
})
export class AppModule {
  constructor() {
    (window as any).AppModule = AppModule;
  }
}
