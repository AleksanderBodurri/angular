/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {importProvidersFrom} from '@angular/core';
import {bootstrapApplication, platformBrowser} from '@angular/platform-browser';
import {BrowserAnimationsModule} from '@angular/platform-browser/animations';
import {RouterModule} from '@angular/router';
import {ApplicationEnvironment, ApplicationOperations} from 'ng-devtools';

import {AppComponent} from './app/app.component';
import {AppModule, foo} from './app/app.module';
import {DemoApplicationEnvironment} from './demo-application-environment';
import {DemoApplicationOperations} from './demo-application-operations';

platformBrowser().bootstrapModule(AppModule).catch((err) => console.error(err));

// const imports = [
//   BrowserAnimationsModule,
//   RouterModule.forRoot([
//     {
//       path: '',
//       loadChildren: () =>
//         import('./app/devtools-app/devtools-app.module').then((m) => m.DevToolsModule),
//       pathMatch: 'full',
//     },
//     {
//       path: 'demo-app',
//       loadChildren: () => import('./app/demo-app/demo-app.module').then((m) => m.DemoAppModule),
//     },
//   ]),
// ]

// bootstrapApplication(AppComponent, {
//   providers: [
//     imports.map(i => importProvidersFrom(i)),
//     {provide: foo, useValue: 'bar'},
//     {
//       provide: ApplicationOperations,
//       useClass: DemoApplicationOperations,
//     },
//     {
//       provide: ApplicationEnvironment,
//       useClass: DemoApplicationEnvironment,
//     },
//   ]
// });