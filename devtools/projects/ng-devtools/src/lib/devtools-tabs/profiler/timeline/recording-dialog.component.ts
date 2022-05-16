/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Component} from '@angular/core';
import {MatProgressBarModule} from '@angular/material/progress-bar';

@Component({
  selector: 'ng-recording-dialog',
  templateUrl: './recording-dialog.component.html',
  styleUrls: ['./recording-dialog.component.scss'],
  standalone: true,
  imports: [MatProgressBarModule]
})
export class RecordingDialogComponent {
}
