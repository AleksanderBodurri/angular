/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Routes} from '@angular/router';

import {AboutComponent} from './about.component';

export const aboutRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    component: AboutComponent,
  },
]
