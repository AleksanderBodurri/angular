/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {CommonModule} from '@angular/common';
import {Component, Input} from '@angular/core';
import {MatCardModule} from '@angular/material/card';
import {MatToolbarModule} from '@angular/material/toolbar';
import {ProfilerFrame} from 'protocol';

import {AngularSplitModule} from '../../../../vendor/angular-split/public_api';
import {BargraphNode} from '../record-formatter/bargraph-formatter';
import {FlamegraphNode} from '../record-formatter/flamegraph-formatter';
import {VisualizationMode} from '../visualization-mode';

import {BargraphVisualizerComponent} from './bargraph-visualizer.component';
import {ExecutionDetailsComponent} from './execution-details.component';
import {FlamegraphVisualizerComponent} from './flamegraph-visualizer.component';
import {TreeMapVisualizerComponent} from './tree-map-visualizer.component';

export interface SelectedEntry {
  entry: BargraphNode|FlamegraphNode;
  selectedDirectives: SelectedDirective[];
  parentHierarchy?: {name: string}[];
}

export interface SelectedDirective {
  directive: string;
  method: string;
  value: number;
}

@Component({
  selector: 'ng-timeline-visualizer',
  templateUrl: './timeline-visualizer.component.html',
  styleUrls: ['./timeline-visualizer.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ExecutionDetailsComponent,
    MatToolbarModule,
    MatCardModule,
    AngularSplitModule,
    BargraphVisualizerComponent,
    TreeMapVisualizerComponent,
    FlamegraphVisualizerComponent,
  ]
})
export class TimelineVisualizerComponent {
  @Input()
  set visualizationMode(mode: VisualizationMode) {
    this._visualizationMode = mode;
    this.selectedEntry = null;
    this.selectedDirectives = [];
    this.parentHierarchy = [];
  }
  @Input() frame: ProfilerFrame;
  @Input() changeDetection: boolean;

  cmpVisualizationModes = VisualizationMode;

  selectedEntry: BargraphNode|FlamegraphNode|null = null;
  selectedDirectives: SelectedDirective[] = [];
  parentHierarchy: {name: string}[] = [];

  /** @internal */
  _visualizationMode: VisualizationMode;

  handleNodeSelect({entry, parentHierarchy, selectedDirectives}: SelectedEntry): void {
    this.selectedEntry = entry;
    this.selectedDirectives = selectedDirectives;
    this.parentHierarchy = parentHierarchy ?? [];
  }
}
