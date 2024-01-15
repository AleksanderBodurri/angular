/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

interface Env {
  LATEST_SHA: string;
}

export interface Environment {
  production: boolean;
  LATEST_SHA: string;
}

export interface Frame {
  name: string;
  frameId: string;
}

export abstract class ApplicationEnvironment {
  abstract get environment(): Environment;
  abstract get isConnectedToTopLevelFrame(): boolean;
  abstract frames: Frame[];
  abstract selectedFrameId: string|null;
  abstract multipleFramesEnabled: boolean;
  abstract inspectedWindowTabId: number|null;
}
