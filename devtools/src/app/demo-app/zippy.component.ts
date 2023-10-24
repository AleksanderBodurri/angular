/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Component, Injectable, Input} from '@angular/core';

@Injectable()
export class ZippyService {}

@Component({
  selector: 'app-zippy',
  templateUrl: './zippy.component.html',
  styleUrls: ['./zippy.component.scss'],
  providers: [ZippyService]
})
export class ZippyComponent {
  @Input() title: string;
  visible = false;
}
