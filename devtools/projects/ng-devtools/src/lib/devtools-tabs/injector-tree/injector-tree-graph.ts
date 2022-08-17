declare const vis: any;
import * as d3 from 'd3';

export interface InjectorTreeGraphNode {}
export interface InjectorTreeGraphEdges {}

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
      private _containerElement: HTMLElement,
      private _graphElement: HTMLElement,
  ) {}

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
    tree.nodeSize([70, 200]);
    tree.separation((a, b) => {
      return 2;
    });

    const root: any = injectorGraph[0];

    const nodes = tree(this.d3.hierarchy(root, (d) => d.children));

    // Define the div for the tooltip
    this.tooltip = this.d3.select('body')
                       .append('div')
                       .attr('class', 'tooltip')
                       .style('opacity', 0)
                       .style('padding', '0');

    g.selectAll('.link')
        .data(nodes.descendants().slice(1))
        .enter()
        .append('path')
        .attr('class', 'link')
        .attr('d', (d) => {return `
              M${d.y},${d.x}
              C${(d.y + (d as any).parent.y) / 2},
                ${d.x} ${(d.y + (d as any).parent.y) / 2},
                ${(d as any).parent.x} ${(d as any).parent.y},
                ${(d as any).parent.x}`});

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

            .attr('transform', (d) => `translate(${d.y},${d.x})`);

    node.append('circle')
        .attr('class', (d) => {return typeToClass[d.data?.injector?.type ?? d.data.type] ?? ''})
        .attr('r', 6);

    node.append('text')
        .attr('dy', (d) => (d.depth === 0 || !d.children ? '0.35em' : '-1.50em'))
        .attr(
            'dx',
            (d: any):
                any => {
                  if (!d.parent && !d.data?.children?.length) {
                    return 13;
                  }

                  if (d.parent && d.data?.children?.length) {
                    return 6;
                  } else if (!d.parent && d.data?.children?.length) {
                    return -13;
                  } else if (d.parent && !d.data?.children?.length) {
                    return 13;
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