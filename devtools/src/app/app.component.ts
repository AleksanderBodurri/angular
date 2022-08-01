/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Component, ElementRef, inject, Inject, Injector, OnInit} from '@angular/core';
import {Router} from '@angular/router';

import {foo} from './app.module';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements OnInit {
  foo = 'bar';

  injector = inject(Injector);

  constructor(public router: Router, @Inject(foo) _foo: string) {}

  ngOnInit(): void {
    console.log('getting element ref');
    this.injector.get(ElementRef);
  }
}
