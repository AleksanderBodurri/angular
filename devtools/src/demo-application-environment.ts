/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {ApplicationEnvironment, Environment} from 'ng-devtools';

import {environment} from './environments/environment';

export class DemoApplicationEnvironment extends ApplicationEnvironment {
  multipleFramesEnabled: false = false;
  frames = [];
  selectedFrameId: null = null;
  inspectedWindowTabId: null = null;

  override get environment(): Environment {
    return environment;
  }

  get isConnectedToTopLevelFrame(): boolean {
    return true;
  }
}
