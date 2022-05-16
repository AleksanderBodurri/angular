/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {DragDropModule} from '@angular/cdk/drag-drop';
import {CommonModule} from '@angular/common';
import {Component, EventEmitter, Input, Output} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {MatExpansionModule} from '@angular/material/expansion';
import {MatIconModule} from '@angular/material/icon';
import {MatToolbarModule} from '@angular/material/toolbar';
import {MatTooltipModule} from '@angular/material/tooltip';
import {MatTreeModule} from '@angular/material/tree';
import {DirectivePosition} from 'protocol';

import {DirectivePropertyResolver, DirectiveTreeData} from '../../property-resolver/directive-property-resolver';
import {ElementPropertyResolver, FlatNode} from '../../property-resolver/element-property-resolver';

import {PropertyViewBodyComponent} from './property-view-body.component';
import {PropertyViewHeaderComponent} from './property-view-header.component';

@Component({
  selector: 'ng-property-view',
  templateUrl: './property-view.component.html',
  styleUrls: ['./property-view.component.scss'],
  standalone: true,
  imports: [
    MatToolbarModule, MatIconModule, MatTooltipModule, CommonModule, MatExpansionModule,
    DragDropModule, FormsModule, PropertyViewHeaderComponent, PropertyViewBodyComponent
  ]
})
export class PropertyViewComponent {
  @Input() directive: string;
  @Output() inspect = new EventEmitter<{node: FlatNode; directivePosition: DirectivePosition}>();

  constructor(private _nestedProps: ElementPropertyResolver) {}

  get controller(): DirectivePropertyResolver|undefined {
    return this._nestedProps.getDirectiveController(this.directive);
  }

  get directiveInputControls(): DirectiveTreeData|void {
    return this.controller?.directiveInputControls;
  }

  get directiveOutputControls(): DirectiveTreeData|void {
    return this.controller?.directiveOutputControls;
  }

  get directiveStateControls(): DirectiveTreeData|void {
    return this.controller?.directiveStateControls;
  }
}
