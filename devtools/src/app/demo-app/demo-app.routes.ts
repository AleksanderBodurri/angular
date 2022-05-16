/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Routes} from '@angular/router';
import {initializeMessageBus} from 'ng-devtools-backend';

import {ZoneUnawareIFrameMessageBus} from '../../zone-unaware-iframe-message-bus';

import {DemoAppComponent} from './demo-app.component';

export const demoAppRoutes: Routes = [{
  path: '',
  component: DemoAppComponent,
  children: [
    {
      path: '',
      loadChildren: () => import('./todo/todo.routes').then((m) => m.todoRoutes),
    },
  ],
}]

initializeMessageBus(new ZoneUnawareIFrameMessageBus(
    'angular-devtools-backend', 'angular-devtools', () => window.parent));
