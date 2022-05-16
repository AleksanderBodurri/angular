import {CommonModule} from '@angular/common';
import {Component, NgModule} from '@angular/core';

import {SplitComponent} from './split.component';
import {SplitAreaDirective} from './splitArea.directive';

@Component({selector: 'test-comp', template: '<ng-content></ng-content>'})
export class TestComponent {
}

@NgModule({
  imports: [CommonModule],
  declarations: [SplitAreaDirective, SplitComponent, TestComponent],
  exports: [SplitAreaDirective, SplitComponent, TestComponent],
})
export class SplitModule {
}
