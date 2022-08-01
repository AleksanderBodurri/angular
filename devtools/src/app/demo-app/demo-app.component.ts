/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Component, ElementRef, EventEmitter, inject, Injectable, Input, Output, ViewChild, ViewEncapsulation} from '@angular/core';
import {Router} from '@angular/router';

import {ZippyComponent} from './zippy.component';



export class Engine {}
export class Car {
  constructor(private _engine: Engine) {}
}

@Injectable()
export class SomeService {
  car = inject(Car);
  constructor() {
    console.log(this.car);
  }
}

@Component({
  selector: 'app-demo-component',
  templateUrl: './demo-app.component.html',
  styleUrls: ['./demo-app.component.scss'],
  encapsulation: ViewEncapsulation.None,
  providers: [

  ]
})
export class DemoAppComponent {
  @ViewChild(ZippyComponent) zippy: ZippyComponent;
  @ViewChild('elementReference') elementRef: ElementRef;

  @Input('input_one') inputOne = 'input one';
  @Input() inputTwo = 'input two';

  @Output() outputOne = new EventEmitter();
  @Output('output_two') outputTwo = new EventEmitter();

  router = inject(Router);

  someService = inject(SomeService);


  getTitle(): '► Click to expand'|'▼ Click to collapse' {
    if (!this.zippy || !this.zippy.visible) {
      return '► Click to expand';
    }
    return '▼ Click to collapse';
  }
}
