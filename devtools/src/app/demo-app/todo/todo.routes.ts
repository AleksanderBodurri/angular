/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Routes} from '@angular/router';

import {AppTodoComponent} from './app-todo.component';

export const todoRoutes: Routes = [
  {
    path: 'todos',
    component: AppTodoComponent,
    children: [
      {
        path: 'app',
        loadChildren: () => import('./home/home.routes').then((m) => m.homeRoutes),
      },
      {
        path: 'about',
        loadChildren: () => import('./about/about.routes').then((m) => m.aboutRoutes),
      },
      {
        path: '**',
        redirectTo: 'app',
      },
    ],
  },
  {
    path: '**',
    redirectTo: 'todos',
  },
]
