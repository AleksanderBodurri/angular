import {Component, ElementRef, EventEmitter, Input, OnInit, Output, ViewChild} from '@angular/core';

import {InjectorTreeGraph} from '../injector-tree/injector-tree-graph';

@Component({
  selector: 'ng-resolution-path',
  template: `
      <section>
        <svg #svgContainer class="svg-container">
            <g #mainGroup></g>
        </svg>
      </section>
    `,
  styles: [`:host { display: block; }`],
  standalone: true
})

export class ResolutionPathComponent implements OnInit {
  @ViewChild('svgContainer', {static: true}) private svgContainer: ElementRef;
  @ViewChild('mainGroup', {static: true}) private g: ElementRef;

  @Input() orientation: 'horizontal'|'vertical' = 'horizontal';
  @Input() nodeSeperation: number = 2;

  private currentInjectorTreeGraph: InjectorTreeGraph;
  private pathNode;

  @Input()
  set path(path: any) {
    path = path.slice().reverse();

    const flatPath: any[] = [];
    path.forEach((injector, idx) => {
      if (injector.importPath?.length > 0) {
        injector.importPath.slice().reverse().forEach((importedModule, idx2) => {
          if (importedModule.owner !== injector.owner) {
            importedModule.position = [idx, idx2];
            flatPath.push(importedModule);
          }
        });
      }

      injector.position = [idx]
      flatPath.push(injector);
    });

    flatPath.forEach((injector, index) => {
      if (index !== flatPath.length - 1) {
        injector.children = [flatPath[index + 1]];
      } else {
        injector.children = [];
      }
    });

    this.pathNode = flatPath[0];
    console.log(this.pathNode);
  }

  @Output() inspectInjector = new EventEmitter<any>();

  constructor() {}

  ngOnInit(): void {
    setTimeout(() => {
      this.currentInjectorTreeGraph = new InjectorTreeGraph(
          this.svgContainer.nativeElement, this.g.nativeElement, this.orientation,
          this.orientation === 'horizontal' ? [75, 200] : [20, 75], this.nodeSeperation);

      this.currentInjectorTreeGraph.update([this.pathNode]);
      this.currentInjectorTreeGraph.onNodeClick((_, node) => {
        console.log(node.data.position);
        this.inspectInjector.emit(node.data.position);
      });
    })
  }
}