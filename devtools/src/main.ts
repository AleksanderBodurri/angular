/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {importProvidersFrom} from '@angular/core';
import {bootstrapApplication} from '@angular/platform-browser';
import {BrowserAnimationsModule} from '@angular/platform-browser/animations';
import {RouterModule} from '@angular/router';
import {ApplicationEnvironment, ApplicationOperations} from 'ng-devtools';

import {AppComponentStandalone} from './app/app.component';
import {DemoApplicationEnvironment} from './demo-application-environment';
import {DemoApplicationOperations} from './demo-application-operations';


const routes: any = [
  {
    path: '',
    loadChildren: () =>
        import('./app/devtools-app/devtools-app.routes').then((m) => m.devtoolsAppRoutes),
    pathMatch: 'full',
  },
  {
    path: 'demo-app',
    loadChildren: () => import('./app/demo-app/demo-app.routes').then((m) => m.demoAppRoutes),
  },
];

bootstrapApplication(AppComponentStandalone, {
  providers: [
    importProvidersFrom(BrowserAnimationsModule),
    importProvidersFrom(RouterModule.forRoot(routes)),
    {
      provide: ApplicationOperations,
      useClass: DemoApplicationOperations,
    },
    {
      provide: ApplicationEnvironment,
      useClass: DemoApplicationEnvironment,
    },
  ]
})
