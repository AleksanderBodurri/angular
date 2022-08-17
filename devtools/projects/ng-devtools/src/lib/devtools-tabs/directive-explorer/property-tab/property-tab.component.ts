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

@Component({
  selector: 'ng-resolution-path',
  template: `
    <section>
      <svg #svgContainer class="svg-container">
          <g #mainGroup></g>
      </svg>
    </section>
  `,
  styles: [`:host { display: block; }`]
})

export class ResolutionPathComponent implements OnInit {
  @ViewChild('svgContainer', {static: true}) private svgContainer: ElementRef;
  @ViewChild('mainGroup', {static: true}) private g: ElementRef;

  private currentInjectorTreeGraph: InjectorTreeGraph;
  private pathNode;

  @Input()
  set path(path: any) {
    path.forEach((injector, index) => {
      injector.position = [index];

      if (index !== path.length - 1) {
        injector.children = [path[index + 1]];
        return;
      }

      injector.children = [];

      if (injector.type === 'NullInjector') {
        // this.specialToken = true;
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

    this.pathNode = path[0];
  }

  @Output() inspectInjector = new EventEmitter<any>();

  constructor() {}

  ngOnInit(): void {
    setTimeout(() => {
      this.currentInjectorTreeGraph =
          new InjectorTreeGraph(this.svgContainer.nativeElement, this.g.nativeElement);
      this.currentInjectorTreeGraph.update([this.pathNode]);
      this.currentInjectorTreeGraph.onNodeClick((_, node) => {
        this.inspectInjector.emit(node.data.position);
      });
    })
  }
}