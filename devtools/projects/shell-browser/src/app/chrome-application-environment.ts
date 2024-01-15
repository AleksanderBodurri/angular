/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {ApplicationEnvironment, Environment, Frame} from 'ng-devtools';

import {environment} from '../environments/environment';

export class ChromeApplicationEnvironment extends ApplicationEnvironment {
  multipleFramesEnabled: true = true;
  frames: Frame[] = [];
  selectedFrameId = null;
  inspectedWindowTabId: number|null = null;

  override get environment(): Environment {
    return environment;
  }

  override get isConnectedToTopLevelFrame(): boolean {
    if (!this.multipleFramesEnabled) {
      return true;
    }

    return this.selectedFrameId === '0';
  }
}
