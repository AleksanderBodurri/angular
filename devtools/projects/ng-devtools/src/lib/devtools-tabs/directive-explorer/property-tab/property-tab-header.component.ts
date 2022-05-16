/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {CommonModule} from '@angular/common';
import {ChangeDetectionStrategy, Component, EventEmitter, Input, Output} from '@angular/core';
import {MatButtonModule} from '@angular/material/button';
import {MatExpansionModule} from '@angular/material/expansion';
import {MatIconModule} from '@angular/material/icon';

import {IndexedNode} from '../directive-forest/index-forest';

import {ComponentMetadataComponent} from './component-metadata.component';

@Component({
  templateUrl: './property-tab-header.component.html',
  selector: 'ng-property-tab-header',
  styleUrls: ['./property-tab-header.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports:
      [CommonModule, ComponentMetadataComponent, MatIconModule, MatExpansionModule, MatButtonModule]
})
export class PropertyTabHeaderComponent {
  @Input() currentSelectedElement: IndexedNode;
  @Input() currentDirectives: string[]|undefined;
  @Output() viewSource = new EventEmitter<void>();

  handleViewSource(event: MouseEvent): void {
    event.stopPropagation();
    this.viewSource.emit();
  }
}
