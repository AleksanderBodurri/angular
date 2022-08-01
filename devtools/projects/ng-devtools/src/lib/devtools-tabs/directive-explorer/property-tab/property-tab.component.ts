/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Component, ElementRef, EventEmitter, Input, Output, ViewChild} from '@angular/core';
import {DirectivePosition, Events, MessageBus} from 'protocol';

import {InjectorTreeGraph} from '../../injector-tree/injector-tree-graph';
import {IndexedNode} from '../directive-forest/index-forest';
import {ElementPropertyResolver, FlatNode} from '../property-resolver/element-property-resolver';

@Component({
  templateUrl: './property-tab.component.html',
  selector: 'ng-property-tab',
  styleUrls: ['./property-tab.component.scss']
})
export class PropertyTabComponent {
  @ViewChild('svgContainer', {static: false}) private svgContainer: ElementRef;
  @ViewChild('mainGroup', {static: false}) private g: ElementRef;

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
      private _nestedProps: ElementPropertyResolver, private _messageBus: MessageBus<Events>) {}

  propertyTabIndex = 0;
  tokenName = '';

  injectorFlagContent = {
    host: {link: 'https://angular.io/api/core/Host'},
    self: {link: 'https://angular.io/api/core/Self'},
    skipSelf: {link: 'https://angular.io/api/core/SkipSelf'},
    optional: {link: 'https://angular.io/api/core/Optional'}
  };

  get injectorParameters(): any[] {
    return this._nestedProps.injectorMetadata;
  }

  get injectorDataLoaded(): boolean {
    return !!this.injectorParameters.length;
  }

  specialToken = false;
  currentInjectorTreeGraph: InjectorTreeGraph|null = null;
  inspectInjectorParameterToken(injectorParameter: any): void {
    this._messageBus.once('injectorParameterResolutionPath', (path) => {
      this.specialToken = false;

      path.forEach((injector, index) => {
        injector.position = [index];

        if (index !== path.length - 1) {
          injector.children = [path[index + 1]];
          return;
        }

        injector.children = [];

        if (injector.type === 'NullInjector') {
          this.specialToken = true;
        }

        if (!injector.importPath?.length) {
          return;
        }

        injector.importPath[0].position = [index];
        path[index - 1].children = [injector.importPath[0]];

        injector.importPath.forEach((importedModule, importedModuleIndex) => {
          if (importedModule.type === 'ImportedModule') {
            importedModule.position = [index, importedModuleIndex - 1];
          }

          importedModule.children = [];

          if (importedModuleIndex !== injector.importPath.length - 1) {
            importedModule.children.push(injector.importPath[importedModuleIndex + 1])
          }
        });
      });

      this.tokenName = injectorParameter.token;
      this.propertyTabIndex = 1;

      if (this.specialToken) {
        return;
      }

      setTimeout(() => {
        this.currentInjectorTreeGraph =
            new InjectorTreeGraph(this.svgContainer.nativeElement, this.g.nativeElement);
        this.currentInjectorTreeGraph.update([path[0]]);
        this.currentInjectorTreeGraph.onNodeClick((pointerEvent, node) => {
          this.inspectInjector.emit({
            directivePosition: this.currentSelectedElement!.position,
            injectorParameter,
            injectorPosition: node.data.position
          });
        });
      });
    });

    this._messageBus.emit(
        'traceInjectorParameterResolutionPath',
        [this.currentSelectedElement!.position, injectorParameter]);
  }
}
