/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Component, EventEmitter, Input, Output} from '@angular/core';
import {DirectivePosition} from 'protocol';

import {IndexedNode} from '../../directive-forest/index-forest';
import {FlatNode} from '../../property-resolver/element-property-resolver';

@Component({
  templateUrl: './property-tab-body.component.html',
  selector: 'ng-property-tab-body',
  styleUrls: ['./property-tab-body.component.scss'],
})
export class PropertyTabBodyComponent {
  @Input()
  set currentSelectedElement(element: IndexedNode|null) {
    this._currentSelectedElement = element;
    this.directives = this.getCurrentDirectives();
  };
  @Output() inspect = new EventEmitter<{node: FlatNode; directivePosition: DirectivePosition}>();
  @Output() inspectInjector = new EventEmitter<any>();

  directives: string[] = [];

  get currentSelectedElement(): IndexedNode|null {
    return this._currentSelectedElement;
  }

  private _currentSelectedElement: IndexedNode|null = null;

  getCurrentDirectives(): string[] {
    if (!this.currentSelectedElement) {
      return [];
    }
    const directives = this.currentSelectedElement.directives.map((d) => d.name);
    if (this.currentSelectedElement.component) {
      directives.push(this.currentSelectedElement.component.name);
    }
    return directives;
  }
}
