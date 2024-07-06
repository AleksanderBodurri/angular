/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Component, effect, EffectRef, inject, Injector, signal} from '@angular/core';
import {Router} from '@angular/router';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  mySignal = signal('AppComponent signal');
  mySignal2 = signal('AppComponent signal2');
  constructorEffect: EffectRef;

  constructor(public router: Router) {
    this.constructorEffect = effect(() => {
      console.log('AppComponent effect');
      console.log('mySignal', this.mySignal());
    })
  }

  classFieldEffect = effect(() => {
    console.log('AppComponent classFieldEffect');
  });

  injector = inject(Injector);

  ngOnInit() {
    this.effectInsideFuction();
  }

  effectInsideFuction() {
    return effect(() => {
      console.log('AppComponent effectInsideFuction');
    }, {injector: this.injector});
  }
}
