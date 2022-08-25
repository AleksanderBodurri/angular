/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {AfterViewInit, Component, ElementRef, EventEmitter, Input, OnInit, Output, ViewChild} from '@angular/core';
import {DirectivePosition} from 'protocol';

import {InjectorTreeGraph} from '../../injector-tree/injector-tree-graph';
import {IndexedNode} from '../directive-forest/index-forest';
import {ElementPropertyResolver, FlatNode} from '../property-resolver/element-property-resolver';

@Component({
  templateUrl: './property-tab.component.html',
  selector: 'ng-property-tab',
  styleUrls: ['./property-tab.component.scss']
})
export class PropertyTabComponent {
  @Output() viewSource = new EventEmitter<void>();
  @Output() inspect = new EventEmitter<{node: FlatNode; directivePosition: DirectivePosition}>();
  @Output() inspectInjector = new EventEmitter<any>();

  @Input()
  set currentSelectedElement(element: IndexedNode|null) {
    this._currentSelectedElement = element;
    this.propertyTabIndex = 0;
    this.tokenName = '';
  };

  get currentSelectedElement(): IndexedNode|null {
    return this._currentSelectedElement;
  }

  private _currentSelectedElement: IndexedNode|null = null;

  constructor(
      private _elementPropertyResolver: ElementPropertyResolver,
  ) {}

  propertyTabIndex = 0;
  tokenName = '';

  injectorFlagContent = {
    host: {link: 'https://angular.io/api/core/Host'},
    self: {link: 'https://angular.io/api/core/Self'},
    skipSelf: {link: 'https://angular.io/api/core/SkipSelf'},
    optional: {link: 'https://angular.io/api/core/Optional'}
  };

  get injectorParameters(): any {
    return this._elementPropertyResolver.injectorMetadata;
  }

  get injectorDataLoaded(): boolean {
    return !!Object.keys(this.injectorParameters ?? {}).length;
  }
}
