/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {DragDropModule} from '@angular/cdk/drag-drop';
import {CommonModule} from '@angular/common';
import {Component, Input, NgModule, OnInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {MatChipsModule} from '@angular/material/chips';
import {MatExpansionModule} from '@angular/material/expansion';
import {MatIconModule} from '@angular/material/icon';
import {MatTabsModule} from '@angular/material/tabs';
import {MatToolbarModule} from '@angular/material/toolbar';
import {MatTooltipModule} from '@angular/material/tooltip';
import {MatTreeModule} from '@angular/material/tree';

import {PropertyEditorComponent} from './property-editor.component';
import {PropertyPreviewComponent} from './property-preview.component';
import {PropertyTabBodyComponent} from './property-tab-body.component';
import {PropertyViewBodyComponent} from './property-view-body.component';
import {PropertyViewHeaderComponent} from './property-view-header.component';
import {PropertyViewTreeComponent} from './property-view-tree.component';
import {PropertyViewComponent} from './property-view.component';

@Component({
  selector: 'ng-property-view-injector-resolution-path',
  template: `
      <div class="graph-panel">
        <div #graphContainer style="max-width: 100%;"></div>
      </div>
  `
})
export class PropertyViewInjectorResolutionPathComponent implements OnInit {
  @Input() directiveInjectorParameters: any;

  constructor() {}
  ngOnInit() {}
}

@NgModule({
  declarations: [
    PropertyViewComponent, PropertyViewTreeComponent, PropertyViewHeaderComponent,
    PropertyViewBodyComponent, PropertyTabBodyComponent, PropertyPreviewComponent,
    PropertyEditorComponent, PropertyViewInjectorResolutionPathComponent
  ],
  imports: [
    MatToolbarModule, MatIconModule, MatTreeModule, MatTooltipModule, CommonModule,
    MatExpansionModule, DragDropModule, FormsModule, MatChipsModule, MatTabsModule
  ],
  exports: [
    PropertyViewComponent,
    PropertyViewTreeComponent,
    PropertyViewHeaderComponent,
    PropertyViewBodyComponent,
    PropertyTabBodyComponent,
    PropertyPreviewComponent,
    PropertyEditorComponent,
  ],
})
export class PropertyViewModule {
}
