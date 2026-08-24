/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {signal} from '@angular/core';
import {ComponentFixture, TestBed} from '@angular/core/testing';
import {By} from '@angular/platform-browser';
import {MatSnackBar} from '@angular/material/snack-bar';

import {DevToolsNode, Events, MessageBus} from '../../../../../../protocol';
import {APP_DATA, AppData} from '../../../application-providers/app_data';
import {DEEP_LINK_INSTANCE_ID} from '../../../application-providers/deep_link';
import {TabUpdate} from '../../tab-update';
import {DirectiveForestComponent} from './directive-forest.component';
import {TreeNodeComponent} from './tree-node/tree-node.component';

function createDummyNode(
  name: string,
  id: number,
  children: DevToolsNode[] = [],
  staticNode: boolean = false,
): DevToolsNode {
  return {
    tagName: name,
    static: staticNode,
    children,
    directives: [],
    component: {id, name, isElement: false},
    nativeElement: document.createElement('div'),
    controlFlowBlock: null,
  };
}

describe('DirectiveForestComponent', () => {
  let component: DirectiveForestComponent;
  let fixture: ComponentFixture<DirectiveForestComponent>;
  let messageBusSpy: jasmine.SpyObj<MessageBus<Events>>;
  let snackBarSpy: jasmine.SpyObj<MatSnackBar>;
  let deepLinkInstanceIdSignal = signal<number | null>(null);

  beforeEach(async () => {
    deepLinkInstanceIdSignal = signal<number | null>(null);
    messageBusSpy = jasmine.createSpyObj('MessageBus', ['on', 'emit', 'once', 'destroy']);
    snackBarSpy = jasmine.createSpyObj('MatSnackBar', ['open']);

    await TestBed.configureTestingModule({
      imports: [DirectiveForestComponent],
      providers: [
        {
          provide: APP_DATA,
          useValue: signal<AppData>({
            devMode: true,
            ivy: true,
            hydration: false,
            fullVersion: '0.0.0',
            majorVersion: 0,
            minorVersion: 0,
            patchVersion: 0,
          }),
        },
        {provide: MessageBus, useValue: messageBusSpy},
        {provide: MatSnackBar, useValue: snackBarSpy},
        {provide: DEEP_LINK_INSTANCE_ID, useValue: deepLinkInstanceIdSignal},
        TabUpdate,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DirectiveForestComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('currentSelectedElement', {
      position: [0],
      children: [],
      directives: [],
      component: null,
      controlFlowBlock: null,
      static: false,
      hasNativeElement: false,
    });
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should update matchedNodes atomically in a single set rather than per-match copies', async () => {
    const tree: DevToolsNode[] = [
      createDummyNode('match-alpha', 1),
      createDummyNode('match-beta', 2),
      createDummyNode('match-gamma', 3),
      createDummyNode('match-delta', 4),
    ];
    fixture.componentRef.setInput('forest', tree);
    await fixture.whenStable();

    const updateSpy = spyOn(component.matchedNodes, 'update').and.callThrough();
    const setSpy = spyOn(component.matchedNodes, 'set').and.callThrough();

    const filterFn = component.filterGenerator('match');
    component.handleFilter(filterFn);

    expect(updateSpy).toHaveBeenCalledTimes(0);
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(component.matchedNodes().size).toBe(4);
  });

  it('should correctly map match highlighting to visible nodes when preceding branches are collapsed', async () => {
    const tree: DevToolsNode[] = [
      createDummyNode('collapsed-parent-cmp', 1, [
        createDummyNode('hidden-child-one', 2),
        createDummyNode('hidden-child-two', 3),
      ]),
      createDummyNode('visible-matching-cmp', 4),
      createDummyNode('visible-different-cmp', 5),
    ];

    fixture.componentRef.setInput('forest', tree);
    await fixture.whenStable();

    // 1. Collapse the parent node
    const parentNode = component.dataSource.data[0];
    component.treeControl.collapse(parentNode);
    await fixture.whenStable();

    // In dataSource.data (all nodes):
    // 0: collapsed-parent-cmp
    // 1: hidden-child-one
    // 2: hidden-child-two
    // 3: visible-matching-cmp
    // 4: visible-different-cmp
    //
    // In _expandedData (rendered visible rows):
    // 0: collapsed-parent-cmp
    // 1: visible-matching-cmp
    // 2: visible-different-cmp

    // 2. Filter for 'matching' (matches visible-matching-cmp at data index 3)
    const filterFn = component.filterGenerator('matching');
    component.handleFilter(filterFn);
    await fixture.whenStable();

    // 3. Inspect the rendered tree nodes in the CDK virtual scroll
    const treeNodes = fixture.debugElement.queryAll(By.directive(TreeNodeComponent));
    expect(treeNodes.length).toBe(3);

    const matchingNodeCmp = treeNodes[1].componentInstance as TreeNodeComponent;
    const differentNodeCmp = treeNodes[2].componentInstance as TreeNodeComponent;

    // visible-matching-cmp is rendered at virtual index 1, but its data index is 3.
    // Keying by node.id ensures it receives its matches:
    expect((matchingNodeCmp as any).textMatches()).toEqual([{startIdx: 8, endIdx: 16}]);
    expect(treeNodes[1].query(By.css('.matched-text'))).not.toBeNull();

    // visible-different-cmp should have NO text matches:
    expect((differentNodeCmp as any).textMatches()).toEqual([]);
    expect(treeNodes[2].query(By.css('.matched-text'))).toBeNull();
  });

  it('should navigate through matched nodes correctly with next and prev', async () => {
    const tree: DevToolsNode[] = [
      createDummyNode('item-first', 1),
      createDummyNode('item-second', 2),
      createDummyNode('item-third', 3),
    ];
    fixture.componentRef.setInput('forest', tree);
    await fixture.whenStable();

    const filterFn = component.filterGenerator('item');
    component.handleFilter(filterFn);
    await fixture.whenStable();

    expect(component.matchesCount()).toBe(3);
    // After handleFilter, the first match (index 0) is selected
    expect(component.currentlyMatchedIndex()).toBe(0);
    expect(component.selectedNode()?.name).toBe('item-first');

    component.navigateMatchedNode('next');
    expect(component.currentlyMatchedIndex()).toBe(1);
    expect(component.selectedNode()?.name).toBe('item-second');

    component.navigateMatchedNode('next');
    expect(component.currentlyMatchedIndex()).toBe(2);
    expect(component.selectedNode()?.name).toBe('item-third');

    // Wraps around to start
    component.navigateMatchedNode('next');
    expect(component.currentlyMatchedIndex()).toBe(0);
    expect(component.selectedNode()?.name).toBe('item-first');

    // Prev wraps around to end
    component.navigateMatchedNode('prev');
    expect(component.currentlyMatchedIndex()).toBe(2);
    expect(component.selectedNode()?.name).toBe('item-third');
  });
});
