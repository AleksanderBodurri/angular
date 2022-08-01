/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Attribute, ChangeDetectorRef, Directive, ElementRef, HostListener, inject, SkipSelf} from '@angular/core';
import {ActivatedRoute} from '@angular/router';


@Directive({selector: '[appTooltip]', providers: []})
export class TooltipDirective {
  visible = false;
  nested = {
    child: {
      grandchild: {
        prop: 1,
      },
    },
  };

  _ar = inject(ActivatedRoute);

  constructor(@Attribute('class') private c: string, @SkipSelf() elementRef: ElementRef) {}

  @HostListener('click')
  handleClick(): void {
    this.visible = !this.visible;
    if (this.visible) {
      (this as any).extraProp = true;
    } else {
      delete (this as any).extraProp;
    }
  }
}

@Directive({selector: '[someDirective]'})
export class SomeDirective {
  _cdr = inject(ChangeDetectorRef);
}
