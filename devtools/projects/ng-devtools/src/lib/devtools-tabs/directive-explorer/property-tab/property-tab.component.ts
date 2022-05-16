/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {CommonModule} from '@angular/common';
import {Component, EventEmitter, Input, Output} from '@angular/core';
import {MatButtonModule} from '@angular/material/button';
import {MatExpansionModule} from '@angular/material/expansion';
import {MatIconModule} from '@angular/material/icon';
import {MatTooltipModule} from '@angular/material/tooltip';
import {DirectivePosition} from 'protocol';

import {IndexedNode} from '../directive-forest/index-forest';
import {FlatNode} from '../property-resolver/element-property-resolver';

import {PropertyTabHeaderComponent} from './property-tab-header.component';
import {PropertyTabBodyComponent} from './property-view/property-tab-body.component';

@Component({
  templateUrl: './property-tab.component.html',
  selector: 'ng-property-tab',
  standalone: true,
  imports: [
    CommonModule, MatButtonModule, MatExpansionModule, MatIconModule, MatTooltipModule,
    PropertyTabHeaderComponent, PropertyTabBodyComponent
  ]
})
export class PropertyTabComponent {
  @Input() currentSelectedElement: IndexedNode;
  @Output() viewSource = new EventEmitter<void>();
  @Output() inspect = new EventEmitter<{node: FlatNode; directivePosition: DirectivePosition}>();
}
