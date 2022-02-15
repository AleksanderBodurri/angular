/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

/// <reference types="resize-observer-browser" />
import {AfterViewInit, Component, DoCheck, Input, OnChanges, OnDestroy, OnInit, SimpleChanges, ViewChild} from '@angular/core';
import {MatSlideToggleChange} from '@angular/material/slide-toggle';
import {MatTabNav} from '@angular/material/tabs';
import {ComponentExplorerView, DevToolsNode, Events, MessageBus, Route} from 'protocol';
import {Subscription} from 'rxjs';

import {ApplicationEnvironment} from '../application-environment/index';
import {Theme, ThemeService} from '../theme-service';

import {DirectiveExplorerComponent} from './directive-explorer/directive-explorer.component';
import {TabUpdate} from './tab-update/index';

type Tab = 'Components'|'Profiler'|'Router Tree'|'Injector Tree';

@Component({
  selector: 'ng-devtools-tabs',
  templateUrl: './devtools-tabs.component.html',
  styleUrls: ['./devtools-tabs.component.scss'],
})
export class DevToolsTabsComponent implements OnInit, OnDestroy {
  @Input() angularVersion: string|undefined = undefined;
  @ViewChild(DirectiveExplorerComponent) directiveExplorer: DirectiveExplorerComponent;
  @ViewChild('navBar', {static: true}) navbar: MatTabNav;

  activeTab: Tab = 'Components';

  inspectorRunning = false;
  routerTreeEnabled = false;
  showCommentNodes = false;

  private _currentThemeSubscription: Subscription;
  currentTheme: Theme;

  routes: Route[] = [];
  forest: DevToolsNode[];
  injectorTree: any = [];

  private _defaultTabs: Tab[] = ['Components', 'Profiler', 'Injector Tree']
  tabs: Tab[] = this._defaultTabs;

  latestSHA = '';

  constructor(
      public tabUpdate: TabUpdate, public themeService: ThemeService,
      private _messageBus: MessageBus<Events>,
      private _applicationEnvironment: ApplicationEnvironment) {}

  ngOnInit(): void {
    this._currentThemeSubscription =
        this.themeService.currentTheme.subscribe((theme) => (this.currentTheme = theme));

    this._messageBus.on('updateRouterTree', (routes) => {
      this.routes = routes || [];
      if (this.routes.length > 0) {
        this.tabs = [...this._defaultTabs, 'Router Tree'];
      }
    });

    this.latestSHA = this._applicationEnvironment.environment.LATEST_SHA.slice(0, 8);

    this._messageBus.on('latestComponentExplorerView', (view: ComponentExplorerView) => {
      this.forest = view.forest;
    });

    this._messageBus.on('latestInjectorGraphView', (forestWithInjectorPaths) => {
      this.injectorTreeReloaded(forestWithInjectorPaths);
    });
  }

  ngAfterViewInit(): void {
    this.navbar.disablePagination = true;
  }

  ngOnDestroy(): void {
    this._currentThemeSubscription.unsubscribe();
  }

  changeTab(tab: Tab): void {
    this.activeTab = tab;
    this.tabUpdate.notify();
    if (tab === 'Router Tree') {
      this._messageBus.emit('getRoutes');
    }
  }

  toggleInspector(): void {
    this.toggleInspectorState();
    this.emitInspectorEvent();
  }

  emitInspectorEvent(): void {
    if (this.inspectorRunning) {
      this._messageBus.emit('inspectorStart');
      this.changeTab('Components');
    } else {
      this._messageBus.emit('inspectorEnd');
      this._messageBus.emit('removeHighlightOverlay');
    }
  }

  toggleInspectorState(): void {
    this.inspectorRunning = !this.inspectorRunning;
  }

  toggleTimingAPI(change: MatSlideToggleChange): void {
    change.checked ? this._messageBus.emit('enableTimingAPI') :
                     this._messageBus.emit('disableTimingAPI');
  }

  reloadInjectorTree() {
    this._messageBus.emit('getLatestInjectorGraphView');
  }

  injectorTreeReloaded(forestWithInjectorPaths: DevToolsNode[]): void {
    const injectorPaths: any[][] = [];
    const grabInjectorPaths =
        (node) => {
          injectorPaths.push(node.resolutionPath.slice().reverse());
          node.children.forEach(child => grabInjectorPaths(child));
        }

    grabInjectorPaths(forestWithInjectorPaths[0]);

    const equalNode = (a, b) => a.owner === b.owner && a.type === b.type;
    const pathExists = (path, value):
        any => {
          let i = 0;
          while (i < path.length && !equalNode(path[i].injector, value)) {
            i++;
          };

          if (i === path.length) {
            return false;
          }

          return path[i];
        }

    const injectorTree: any = [];
    for (const path of injectorPaths) {
      let currentLevel = injectorTree;
      for (const injector of path) {
        let existingPath = pathExists(currentLevel, injector);

        if (existingPath) {
          currentLevel = existingPath.children;
          continue;
        }

        currentLevel.push({
          injector,
          children: [],
        });
        currentLevel = currentLevel[currentLevel.length - 1].children;
      }
    }

    this.injectorTree = injectorTree;
  }

  setInjectorDebugTabFocus(injectorParameter: any): void {
    console.log(injectorParameter);
  }
}
