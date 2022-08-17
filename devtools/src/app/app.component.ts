/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {DOCUMENT} from '@angular/common';
import {HttpClient} from '@angular/common/http';
import {Component, ElementRef, inject, Inject, Injectable, Injector, OnInit} from '@angular/core';
import {Router} from '@angular/router';

import {foo} from './app.module';

@Injectable()
export class SomeService {
  doc = inject(DOCUMENT);
}

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  providers: [HttpClient]
})
export class AppComponent {
  foo = 'bar';

  httpClient = inject(HttpClient);

  constructor(public router: Router, @Inject(foo) _foo: string) {}
}
