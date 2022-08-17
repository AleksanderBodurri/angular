/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {DOCUMENT} from '@angular/common';
import {HttpClientModule} from '@angular/common/http';
import {Component, Directive, inject, Injectable, InjectionToken, ModuleWithProviders, NgModule} from '@angular/core';
import {BrowserAnimationsModule} from '@angular/platform-browser/animations';
import {Router, RouterModule} from '@angular/router';
import {ApplicationEnvironment, ApplicationOperations} from 'ng-devtools';

import {DemoApplicationEnvironment} from '../demo-application-environment';
import {DemoApplicationOperations} from '../demo-application-operations';

import {AppComponent} from './app.component';

@Injectable()
class SomeFeatureService {
  router = inject(Router)
}

@Injectable()
class SomeFeatureService2 {
  router = inject(Router)
}

@Component({template: `<div>some component</div>`, selector: 'app-some-component'})
export class SomeComponent {
  doc = inject(DOCUMENT);
}

@Directive({selector: '[appSomeDirective]', providers: [SomeFeatureService]})
export class SomeDirective {
  featureService2 = inject(SomeFeatureService);
}

@NgModule({providers: [SomeFeatureService]})
export class SomeFeatureModule2 {
  static init(): ModuleWithProviders<SomeFeatureModule2> {
    return {
      ngModule: SomeFeatureModule2, providers: []
    }
  }
}

@NgModule({
  declarations: [SomeComponent, SomeDirective],
  exports: [SomeComponent, SomeDirective],
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
    SomeFeatureModule, HttpClientModule
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
}
