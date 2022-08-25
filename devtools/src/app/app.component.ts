/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {AnimationBuilder} from '@angular/animations';
import {AnimationDriver} from '@angular/animations/browser';
import {DOCUMENT} from '@angular/common';
import {HttpClient} from '@angular/common/http';
import {Component, inject, Inject, Injectable} from '@angular/core';
import {DomSanitizer, Meta, Title} from '@angular/platform-browser';
import {ActivatedRoute, Router} from '@angular/router';

import {foo} from './app.module';

@Injectable()
export class APIService {
  httpClient = inject(HttpClient);
  router = inject(Router);
  title = inject(Title);
}

@Injectable()
export class AnimationService {
  animationBuilder = inject(AnimationBuilder);
  animationDriver = inject(AnimationDriver);
}

@Injectable()
export class ScriptService {
  doc = inject(DOCUMENT);
  domSanitizer = inject(DomSanitizer);
  meta = inject(Meta);
}

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  providers: [ScriptService, APIService, AnimationService]
})
export class AppComponent {
  foo = 'bar';

  scriptService = inject(ScriptService);
  api = inject(APIService);
  animationService = inject(AnimationService);

  constructor(public router: Router, @Inject(foo) _foo: string) {}
}
