/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {ChangeDetectionStrategy, Component, input, output} from '@angular/core';

import {IndexedNode} from '../directive-forest/index-forest';
import {ComponentMetadataComponent} from './component-metadata.component';
import {MatExpansionModule} from '@angular/material/expansion';
import {MatIcon} from '@angular/material/icon';
import {MatIconButton} from '@angular/material/button';

@Component({
  templateUrl: './property-tab-header.component.html',
  selector: 'ng-property-tab-header',
  styleUrls: ['./property-tab-header.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatExpansionModule, ComponentMetadataComponent, MatIcon, MatIconButton],
})
export class PropertyTabHeaderComponent {
  currentSelectedElement = input.required<IndexedNode>();
  toggleSignalGraph = output<void>();

  handleToggleSignalGraph(event: MouseEvent) {
    event.stopPropagation();
    this.toggleSignalGraph.emit();
  }
}
