/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {CommonModule} from '@angular/common';
import {Component, Inject} from '@angular/core';
import {MAT_DIALOG_DATA, MatDialogModule, MatDialogRef} from '@angular/material/dialog';

interface DialogData {
  profilerVersion?: number;
  importedVersion?: number;
  errorMessage?: string;
  status: 'ERROR'|'INVALID_VERSION';
}

@Component({
  selector: 'ng-profiler-import-dialog',
  templateUrl: './profiler-import-dialog.component.html',
  styleUrls: ['./profiler-import-dialog.component.scss'],
  standalone: true,
  imports: [CommonModule, MatDialogModule]
})
export class ProfilerImportDialogComponent {
  constructor(
      public dialogRef: MatDialogRef<ProfilerImportDialogComponent>,
      @Inject(MAT_DIALOG_DATA) public data: DialogData) {}
}
