declare const vis: any;
import * as d3 from 'd3';

export interface InjectorTreeGraphNode {}
export interface InjectorTreeGraphEdges {}

let arrowDefId = 0;

const typeToClass = {
  Module: 'node-module',
  ImportedModule: 'node-imported-module',
  Element: 'node-element',
  NullInjector: 'node-null',
  Injector: 'node-injector',
  Platform: 'node-platform'
}

export class InjectorTreeGraph {
  nodes: InjectorTreeGraphNode[] = []
  edges: InjectorTreeGraphEdges[] = [];
  private tooltip: any;

  constructor(
      private _containerElement: HTMLElement, private _graphElement: HTMLElement,
      private _orientation: 'horizontal'|'vertical' = 'horizontal',
      private _nodeSize: [number, number] = [70, 200], private _nodeSeperation?: number,
      private _childFn?: any) {
    if (!this._childFn) {
      this._childFn = (d) => d.children;
    }
    if (this._nodeSeperation === undefined) {
      this._nodeSeperation = 2;
    }
  }

  private _nodeClickListeners: any[] = [];
  private _currentInjectorGraph: any;
  private d3 = d3;

  onNodeClick(cb: (pointerEvent: PointerEvent, node: d3.Node) => void): void {
    this._nodeClickListeners.push(cb);
  }

  update(injectorGraph: any) {
    this._nodeClickListeners = [];
    this.render(injectorGraph);
    this._currentInjectorGraph = injectorGraph;
  }

  render(injectorGraph): void {
    // cleanup old render
    this.tooltip?.remove?.();
    this.d3.select(this._graphElement).selectAll('*').remove();

    const tree = this.d3.tree();
    const svg = this.d3.select(this._containerElement);
    svg.attr('height', 500).attr('width', 500);

    const g = this.d3.select(this._graphElement);
    const svgPadding = 20;

    // Compute the new tree layout.
    tree.nodeSize(this._nodeSize);
    if (this._nodeSeperation !== undefined) {
      tree.separation((a, b) => {
        return this._nodeSeperation;
      });
    }

    const root: any = injectorGraph[0];

    const nodes = tree(this.d3.hierarchy(root, (d) => d.children));

    // Define the div for the tooltip
    this.tooltip = this.d3.select('body')
                       .append('div')
                       .attr('class', 'tooltip')
                       .style('opacity', 0)
                       .style('padding', '0');

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
        .attr('markerWidth', 12)
        .attr('markerHeight', 12)
        .attr('orient', 'auto')
        .append('svg:path')
        .attr('d', 'M0,-5L10,0L0,5');

    let links
    if (this._orientation === 'horizontal') {
      links = g.selectAll('.link')
                  .data(nodes.descendants().slice(1))
                  .enter()
                  .append('path')
                  .attr('class', 'link')
                  .attr('marker-end', `url(#end${arrowDefId})`)
                  .attr('d', (d) => {return `
            M${d.y},${d.x}
            C${(d.y + (d as any).parent.y) / 2},
              ${d.x} ${(d.y + (d as any).parent.y) / 2},
              ${(d as any).parent.x} ${(d as any).parent.y},
              ${(d as any).parent.x}`});
    }

    if (this._orientation === 'vertical') {
      links = g.selectAll('.link')
                  .data(nodes.descendants().slice(1))
                  .enter()
                  .append('path')
                  .attr('class', 'link')
                  .attr('marker-end', `url(#end${arrowDefId})`)
                  .attr('d', (d) => {return `
                M${d.x},${d.y}
                C${(d.x + (d as any).parent.x) / 2},
                  ${d.y} ${(d.x + (d as any).parent.x) / 2},
                  ${(d as any).parent.y} ${(d as any).parent.x},
                  ${(d as any).parent.y}`});
    }


    // Declare the nodes
    const node =
        g.selectAll('g.node')
            .data(nodes.descendants())
            .enter()
            .append('g')
            .attr('class', 'node')
            .on('click',
                (pointerEvent, node) => {
                  this._nodeClickListeners.forEach(listener => listener(pointerEvent, node));
                })
            .on('mouseover',
                (e, node) => {
                  const owner = node.data.injector?.owner ?? node.data.owner;
                  this.tooltip.style('padding', '4px 8px').transition().style('opacity', 0.9);
                  this.tooltip.html(owner)
                      .style('left', e.pageX + 8 + 'px')
                      .style('top', e.pageY + 8 + 'px');
                })
            .on('mouseout', () => this.tooltip.transition().style('opacity', 0))

            .attr('transform', (d) => {
              if (this._orientation === 'horizontal') {
                return `translate(${d.y},${d.x})`
              }

              return `translate(${d.x},${d.y})`
            });

    node.append('circle')
        .attr('class', (d) => {return typeToClass[d.data?.injector?.type ?? d.data.type] ?? ''})
        .attr('r', 6);

    node.append('text')
        .attr(
            this._orientation === 'horizontal' ? 'dy' : 'dx',
            (d) => (d.depth === 0 || !d.children ? '0.6em' : '-1.55em'))
        .attr(
            this._orientation === 'horizontal' ? 'dx' : 'dy',
            (d: any):
                any => {
                  if (this._orientation === 'horizontal') {
                    if (!d.parent && !d.data?.children?.length) {
                      return 15;
                    }

                    if (d.parent && d.data?.children?.length) {
                      return 8;
                    } else if (!d.parent && d.data?.children?.length) {
                      return -15;
                    } else if (d.parent && !d.data?.children?.length) {
                      return 15;
                    }
                  }
                  if (this._orientation === 'vertical') {
                    if (!d.parent && !d.data?.children?.length) {
                      return 5;
                    }

                    if (d.parent && d.data?.children?.length) {
                      return -8;
                    } else if (!d.parent && d.data?.children?.length) {
                      return -15;
                    } else if (d.parent && !d.data?.children?.length) {
                      return 5;
                    }
                  }
                })
        .attr('text-anchor', (d) => (d.children ? 'end' : 'start'))
        .text((d) => {
          if (d.data.injector?.type === 'Element' || d.data.type === 'Element') {
            const owner = d.data.injector?.owner ?? d.data.owner;
            const label = owner.split('[')[0];

            return label.length > 30 ? label.slice(0, 27) + '...' : label;
          } else {
            const label = d.data.injector?.owner ?? d.data.owner;
            return label.length > 30 ? label.slice(0, 27) + '...' : label;
          }
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