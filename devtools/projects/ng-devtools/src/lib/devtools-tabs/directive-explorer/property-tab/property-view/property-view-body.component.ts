/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {CdkDragDrop, moveItemInArray} from '@angular/cdk/drag-drop';
import {Component, ElementRef, EventEmitter, Input, OnInit, Output, ViewChild} from '@angular/core';
import {DirectivePosition, Events, MessageBus} from 'protocol';

import {InjectorTreeGraph} from '../../../injector-tree/injector-tree-graph';
import {DirectivePropertyResolver, DirectiveTreeData} from '../../property-resolver/directive-property-resolver';
import {FlatNode} from '../../property-resolver/element-property-resolver';

@Component({
  selector: 'ng-property-view-body',
  templateUrl: './property-view-body.component.html',
  styleUrls: ['./property-view-body.component.scss'],
})
export class PropertyViewBodyComponent {
  @ViewChild('svgContainer', {static: false}) private svgContainer: ElementRef;
  @ViewChild('mainGroup', {static: false}) private g: ElementRef;

  @Input() controller: DirectivePropertyResolver;
  @Input() directiveInjectorParameters: any;
  @Input() directiveInputControls: DirectiveTreeData;
  @Input() directiveOutputControls: DirectiveTreeData;
  @Input() directiveStateControls: DirectiveTreeData;

  @Output() inspect = new EventEmitter<{node: FlatNode; directivePosition: DirectivePosition}>();
  @Output() inspectInjector = new EventEmitter<any>();

  constructor(private _messageBus: MessageBus<Events>) {}

  categoryOrder = [0, 1, 2];
  injectorFlagContent = {
    Attribute: {link: 'https://angular.io/api/core/Attribute'},
    Host: {link: 'https://angular.io/api/core/Host'},
    Self: {link: 'https://angular.io/api/core/Self'},
    SkipSelf: {link: 'https://angular.io/api/core/SkipSelf'},
    Inject: {link: 'https://angular.io/api/core/Inject'},
    Optional: {link: 'https://angular.io/api/core/Optional'}
  };

  propertyTabIndex = 0;
  tokenName = '';

  get panels(): {
    title: string; hidden: boolean; controls: DirectiveTreeData; documentation: string,
                                                                 class: string
  }[] {
    return [
      {
        title: '@Inputs',
        hidden: this.directiveInputControls.dataSource.data.length === 0,
        controls: this.directiveInputControls,
        documentation: 'https://angular.io/api/core/Input',
        class: 'cy-inputs'
      },
      {
        title: '@Outputs',
        hidden: this.directiveOutputControls.dataSource.data.length === 0,
        controls: this.directiveOutputControls,
        documentation: 'https://angular.io/api/core/Output',
        class: 'cy-outputs'
      },
      {
        title: 'Properties',
        hidden: this.directiveStateControls.dataSource.data.length === 0,
        controls: this.directiveStateControls,
        documentation: 'https://angular.io/guide/property-binding',
        class: 'cy-properties'
      },
    ];
  }

  get controlsLoaded(): boolean {
    return !!this.directiveStateControls && !!this.directiveOutputControls &&
        !!this.directiveInputControls;
  }

  updateValue({node, newValue}: {node: FlatNode; newValue: any}): void {
    this.controller.updateValue(node, newValue);
  }

  drop(event: CdkDragDrop<any, any>): void {
    moveItemInArray(this.categoryOrder, event.previousIndex, event.currentIndex);
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
            directivePosition: this.controller.directivePosition,
            injectorParameter,
            injectorPosition: node.data.position
          });

          // this._messageBus.emit(
          //   'inspectInjector',
          //   [
          //     this.controller.directivePosition,
          //     injectorParameter,
          //     injectorName: 'AppModule'
          //   ]
          // );
        });
      });
    });

    this._messageBus.emit(
        'traceInjectorParameterResolutionPath',
        [this.controller.directivePosition, injectorParameter]);
  }

  handleInspect(node: FlatNode): void {
    this.inspect.emit({
      node,
      directivePosition: this.controller.directivePosition,
    });
  }
}
