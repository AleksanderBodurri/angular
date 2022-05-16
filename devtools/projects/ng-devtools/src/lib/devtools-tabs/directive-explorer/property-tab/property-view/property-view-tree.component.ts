/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {FlatTreeControl} from '@angular/cdk/tree';
import {CommonModule} from '@angular/common';
import {Component, EventEmitter, Input, Output} from '@angular/core';
import {MatIconModule} from '@angular/material/icon';
import {MatTreeModule} from '@angular/material/tree';

import {FlatNode} from '../../property-resolver/element-property-resolver';
import {PropertyDataSource} from '../../property-resolver/property-data-source';

import {PropertyEditorComponent} from './property-editor.component';
import {PropertyPreviewComponent} from './property-preview.component';

@Component({
  selector: 'ng-property-view-tree',
  templateUrl: './property-view-tree.component.html',
  styleUrls: ['./property-view-tree.component.scss'],
  standalone: true,
  imports: [
    CommonModule, PropertyEditorComponent, PropertyPreviewComponent, MatTreeModule, MatIconModule
  ]
})
export class PropertyViewTreeComponent {
  @Input() dataSource: PropertyDataSource;
  @Input() treeControl: FlatTreeControl<FlatNode>;
  @Output() updateValue = new EventEmitter<any>();
  @Output() inspect = new EventEmitter<any>();

  hasChild = (_: number, node: FlatNode): boolean => node.expandable;

  toggle(node: FlatNode): void {
    if (this.treeControl.isExpanded(node)) {
      this.treeControl.collapse(node);
      return;
    }
    this.expand(node);
  }

  expand(node: FlatNode): void {
    const {prop} = node;
    if (!prop.descriptor.expandable) {
      return;
    }
    this.treeControl.expand(node);
  }

  handleUpdate(node: FlatNode, newValue: any): void {
    this.updateValue.emit({
      node,
      newValue,
    });
  }
}
