/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import * as d3 from 'd3';
import {SerializedInjector} from 'protocol';

let arrowDefId = 0;

const injectorTypeToClassMap = new Map<string, string>([
  ['imported-module', 'node-imported-module'],
  ['environment', 'node-environment'],
  ['element', 'node-element'],
]);

export interface InjectorTreeNode {
  injector: SerializedInjector;
  children: InjectorTreeNode[];
}

export interface InjectorTreeD3Node {
  children: InjectorTreeD3Node[];
  data: InjectorTreeNode;
  depth: number;
  height: number;
  parent?: InjectorTreeD3Node;
  x: number;
  y: number;
}

export abstract class GraphRenderer<T, U> {
  abstract render(graph: T): void;
  abstract getNodeById(id: string): U;
  abstract getGraphElement(): HTMLElement;
  abstract snapToNode(node: U): void;

  protected nodeClickListeners: ((pointerEvent: PointerEvent, node: U) => void)[] = [];
  protected nodeMouseoverListeners: ((pointerEvent: PointerEvent, node: U) => void)[] = [];
  protected nodeMouseoutListeners: ((pointerEvent: PointerEvent, node: U) => void)[] = [];

  cleanup(): void {
    this.nodeClickListeners = [];
    this.nodeMouseoverListeners = [];
    this.nodeMouseoutListeners = [];
  }

  onNodeClick(cb: (pointerEvent: PointerEvent, node: U) => void): void {
    this.nodeClickListeners.push(cb);
  }

  onNodeMouseover(cb: (pointerEvent: PointerEvent, node: U) => void): void {
    this.nodeMouseoverListeners.push(cb);
  }

  onNodeMouseout(cb: (pointerEvent: PointerEvent, node: U) => void): void {
    this.nodeMouseoutListeners.push(cb);
  }
}

export class D3GraphRenderer extends GraphRenderer<InjectorTreeNode, InjectorTreeD3Node> {
  constructor(
      private _containerElement: HTMLElement,
      private _graphElement: HTMLElement,
      public config: {
        orientation?: 'horizontal'|'vertical',
        nodeSize?: [width: number, height: number],
        nodeSeperation?: number,
      } = {},
  ) {
    super();

    if (config.orientation === undefined) {
      config.orientation = 'horizontal';
    }
    if (config.nodeSize === undefined) {
      config.nodeSize = [70, 200];
    }
    if (config.nodeSeperation === undefined) {
      config.nodeSeperation = 2;
    }
  }

  private d3 = d3;

  override snapToNode(node: InjectorTreeD3Node): void {
    const id = node.data.injector.id;
    const element = this.getGraphElement().querySelector(`.node[data-id="${id}"]`);
    if (element) {
      element.scrollIntoView({behavior: 'smooth'});
    }
  }

  override getGraphElement(): HTMLElement {
    return this._graphElement;
  }

  override getNodeById(id: string): InjectorTreeD3Node {
    return this.d3.select(`.node[data-id="${id}"]`).datum();
  }

  override cleanup(): void {
    super.cleanup();
    this.d3.select(this._graphElement).selectAll('*').remove();
  }

  override render(injectorGraph: InjectorTreeNode): void {
    // cleanup old graph
    this.cleanup();

    const tree = this.d3.tree();
    const svg = this.d3.select(this._containerElement);

    const g = this.d3.select(this._graphElement);
    const svgPadding = 20;

    // Compute the new tree layout.
    tree.nodeSize(this.config.nodeSize);
    if (this.config.nodeSeperation !== undefined) {
      tree.separation((a, b) => {
        return this.config.nodeSeperation;
      });
    }

    const root = injectorGraph;
    const nodes = tree(
      this.d3.hierarchy(root, (node: InjectorTreeD3Node) => node.children),
      {
        sort: (a, b) => d3.descending(a.height, b.height),
        tree: this.d3.cluster,
      }
    );

    arrowDefId++;
    svg.append('svg:defs')
        .selectAll('marker')
        .data([`end${arrowDefId}`])  // Different link/path types can be defined here
        .enter()
        .append('svg:marker')  // This section adds in the arrows
        .attr('id', String)
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 15)
        .attr('refY', 0)
        .attr('class', 'arrow')
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('svg:path')
        .attr('d', 'M0,-5L10,0L0,5');

    g.selectAll('.link')
        .data(nodes.descendants().slice(1))
        .enter()
        .append('path')
        .attr('class', (node: InjectorTreeD3Node) => {
          const parentId = node.parent?.data?.injector?.id;
          if (parentId === 'N/A') {
            return 'link-hidden';
          }
          
          return `link`;
        })
        .attr(
            'data-id',
            (node: InjectorTreeD3Node) => {
              const from = node.data.injector.id;
              const to = node.parent?.data?.injector?.id;

              if (from && to) {
                return `${from}-to-${to}`;
              }
              return '';
            })
        .attr('marker-end', `url(#end${arrowDefId})`)
        .attr('d', (node: InjectorTreeD3Node) => {
          const parent = node.parent!;
          if (this.config.orientation === 'horizontal') {
            return `
                    M${node.y},${node.x}
                    C${(node.y + parent.y) / 2},
                      ${node.x} ${(node.y + parent.y) / 2},
                      ${parent.x} ${parent.y},
                      ${parent.x}`;
          }

          return `
              M${node.x},${node.y}
              C${(node.x + parent.x) / 2},
                ${node.y} ${(node.x + parent.x) / 2},
                ${parent.y} ${parent.x},
                ${parent.y}`;
        });

    // Declare the nodes
    const node =
        g.selectAll('g.node')
            .data(nodes.descendants())
            .enter()
            .append('g')
            .attr('class', (node: InjectorTreeD3Node) => {
              if (node.data.injector.id === 'N/A') {
                return 'node-hidden';
              }
              return `node`;
            })
            .attr(
                'data-component-id',
                (node: InjectorTreeD3Node) => {
                  const injector = node.data.injector;
                  if (injector.type === 'element') {
                    return injector.node?.component?.id ?? -1;
                  }

                  return -1
                })
            .attr(
                'data-id',
                (node: InjectorTreeD3Node) => {
                  const injector = node.data.injector;

                  return node.data.injector.id;
                })
            .on('click',
                (pointerEvent, node: InjectorTreeD3Node) => {
                  this.nodeClickListeners.forEach(listener => listener(pointerEvent, node));
                })
            .on('mouseover',
                (pointerEvent, node: InjectorTreeD3Node) => {
                  this.nodeMouseoverListeners.forEach(listener => listener(pointerEvent, node));
                })
            .on('mouseout',
                (pointerEvent, node: InjectorTreeD3Node) => {
                  this.nodeMouseoutListeners.forEach(listener => listener(pointerEvent, node));
                })

            .attr('transform', (node: InjectorTreeD3Node) => {
              if (this.config.orientation === 'horizontal') {
                return `translate(${node.y},${node.x})`;
              }

              return `translate(${node.x},${node.y})`;
            });

    node.append('circle')
        .attr(
            'class',
            (node: InjectorTreeD3Node) => {
              return injectorTypeToClassMap.get(node.data?.injector?.type) ?? '';
            })
        .attr('r', 8);

    node.append('text')
        .attr(
            this.config.orientation === 'horizontal' ? 'dy' : 'dx',
            (node: InjectorTreeD3Node) =>
                (node.depth === 0 || !node.children ? '0.6em' : '-1.55em'))
        .attr(
            this.config.orientation === 'horizontal' ? 'dx' : 'dy',
            (node: InjectorTreeD3Node):
                number => {
                  let textOffset = 0;

                  if (!hasParent(node) && !hasChildren(node)) {
                    textOffset = this.config.orientation === 'horizontal' ? 15 : 5;
                  } else if (hasParent(node) && hasChildren(node)) {
                    textOffset = this.config.orientation === 'horizontal' ? 8 : -8;
                  } else if (!hasParent(node) && hasChildren(node)) {
                    textOffset = -15;
                  } else {
                    textOffset = this.config.orientation === 'horizontal' ? 15 : 5;
                  }

                  return textOffset;
                })
        .attr('text-anchor', (node: InjectorTreeD3Node) => (node.children ? 'end' : 'start'))
        .text((node: InjectorTreeD3Node) => {
          const label = node.data.injector.name;
          const lengthLimit = 30;
          return label.length > lengthLimit ? label.slice(0, lengthLimit - '...'.length) + '...' :
                                              label;
        });

    // reset transform
    g.attr('transform', 'translate(0, 0)');

    const svgRect = this._containerElement.getBoundingClientRect();
    const gElRect = this._graphElement.getBoundingClientRect();

    g.attr('transform', `translate(
          ${svgRect.left - gElRect.left + svgPadding},
          ${svgRect.top - gElRect.top + svgPadding}
        )`);
    const height = gElRect.height + svgPadding * 2;
    const width = gElRect.width + svgPadding * 2;
    svg.attr('height', height).attr('width', width);
  }
}

export class InjectorTreeVisualizer {
  constructor(private graphRenderer: GraphRenderer<InjectorTreeNode, InjectorTreeD3Node>) {}

  snapToNode(node: InjectorTreeD3Node): void {
    this.graphRenderer.snapToNode(node);
  }

  getNodeByComponentId(id: number): InjectorTreeD3Node|null {
    const graphElement = this.graphRenderer.getGraphElement();
    const element = graphElement.querySelector(`.node[data-component-id="${id}"]`);
    if (element === null) {
      return null;
    }

    const injectorId = element.getAttribute('data-id');
    if (injectorId === null) {
      return null;
    }

    return this.getNodeById(injectorId);
  }

  getNodeById(id: string): InjectorTreeD3Node|null {
    return this.graphRenderer.getNodeById(id);
  }

  onInjectorClick(cb: (pointerEvent: PointerEvent, node: InjectorTreeD3Node) => void): void {
    this.graphRenderer.onNodeClick(cb);
  }

  onInjectorMouseover(cb: (pointerEvent: PointerEvent, node: InjectorTreeD3Node) => void): void {
    this.graphRenderer.onNodeMouseover(cb);
  }

  onInjectorMouseout(cb: (pointerEvent: PointerEvent, node: InjectorTreeD3Node) => void): void {
    this.graphRenderer.onNodeMouseout(cb);
  }

  render(injectorTree: InjectorTreeNode): void {
    this.graphRenderer.render(injectorTree);
  }

  cleanup(): void {
    this.graphRenderer.cleanup();
  }
}


function hasChildren(node: InjectorTreeD3Node) {
  return !!node.data?.children?.length;
}

function hasParent(node: InjectorTreeD3Node) {
  return !!node.parent;
}
