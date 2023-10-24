/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Component, Injectable, NgModule, inject} from '@angular/core';
import {Router, RouterOutlet} from '@angular/router';

@Injectable()
export class MyService {
}
@Injectable({ providedIn: 'root' })
export class MyServiceB {
}

@NgModule({providers: [MyService]})
export class TestModule {
}

@Component({
  selector: 'app-root',
  template: `<router-outlet></router-outlet>`,
  standalone: true,
  imports: [RouterOutlet, TestModule]
})
export class AppComponent {
  a = inject(MyServiceB);
  constructor(public router: Router) {}
}
