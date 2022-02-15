import {AfterViewInit, Component, ElementRef, EventEmitter, Input, NgModule, Output, ViewChild} from '@angular/core';
import {MatButtonModule} from '@angular/material/button';

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

    this.injectorTreeGraph.update(injectorTree);
  };
  injectorTreeGraph: InjectorTreeGraph;

  ngAfterViewInit() {
    this.injectorTreeGraph =
        new InjectorTreeGraph(this.svgContainer.nativeElement, this.g.nativeElement);
  }
}


@NgModule({
  imports: [MatButtonModule],
  exports: [InjectorTreeComponent],
  declarations: [InjectorTreeComponent],
})
export class InjectorTreeModule {
}
