import {CommonModule} from '@angular/common';
import {AfterViewInit, Component, ElementRef, EventEmitter, Input, NgModule, Output, ViewChild} from '@angular/core';
import {MatButtonModule} from '@angular/material/button';
import {MatExpansionModule} from '@angular/material/expansion';
import {MatTabsModule} from '@angular/material/tabs';
import {Events, MessageBus} from 'protocol';

import {AngularSplitModule} from '../../vendor/angular-split/public_api';
import {ResolutionPathComponent} from '../resolution-path/resolution-path.component';

import {InjectorTreeGraph} from './injector-tree-graph';

@Component({
  selector: 'ng-injector-tree',
  templateUrl: 'injector-tree.component.html',
  styleUrls: ['./injector-tree.component.scss']
})
export class InjectorTreeComponent implements AfterViewInit {
  @ViewChild('svgContainer', {static: true}) private svgContainer: ElementRef;
  @ViewChild('mainGroup', {static: true}) private g: ElementRef;

  @Output() reloadInjectorTree = new EventEmitter<void>();

  @Input()
  set injectorTree(injectorTree: any[]) {
    if (!this.injectorTreeGraph) {
      return;
    }

    this._render(injectorTree);
  };

  constructor(private _messageBus: MessageBus<Events>) {}

  selectedNode: any;
  injectorTreeGraph: InjectorTreeGraph;
  providers: any[] = [];

  private _render(injectorTree: any[]): void {
    if (injectorTree[0]?.children?.[0].injector.owner === 'R3Injector') {
      injectorTree[0].children[0].injector.owner = 'Platform';
    }
    console.log(injectorTree);

    this.injectorTreeGraph.update(injectorTree);

    this.injectorTreeGraph.onNodeClick((event, node) => {
      this.selectedNode = node.data;

      this._messageBus.once('receiveProviders', (providers) => {
        console.log(providers);
        this.providers = providers.filter(p => (p.dependencies ?? []).length > 0);
      });


      if (node.data.injector.node) {
        this._messageBus.emit('getProviders', [{
                                injector: {
                                  ...node.data.injector,
                                  node: {
                                    component: node.data.injector.node.component,
                                    directives: node.data.injector.node.directives
                                  }
                                }
                              }]);
      } else {
        this._messageBus.emit('getProviders', [{injector: node.data.injector}]);
      }
    });
  }

  ngAfterViewInit() {
    this.injectorTreeGraph =
        new InjectorTreeGraph(this.svgContainer.nativeElement, this.g.nativeElement);
    // this.injectorTreeGraph = new InjectorTreeGraph(this.svgContainer.nativeElement,
    // this.g.nativeElement, 'vertical', [125, 100], 2);
  }
}


@NgModule({
  imports: [
    CommonModule, MatButtonModule, AngularSplitModule, ResolutionPathComponent, MatTabsModule,
    MatExpansionModule
  ],
  exports: [InjectorTreeComponent],
  declarations: [InjectorTreeComponent],
})
export class InjectorTreeModule {
}
