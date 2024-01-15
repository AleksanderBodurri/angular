/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

/// <reference types="chrome"/>

import {inject} from '@angular/core';
import {ApplicationEnvironment, ApplicationOperations} from 'ng-devtools';
import {DirectivePosition, ElementPosition} from 'protocol';

export class ChromeApplicationOperations extends ApplicationOperations {
  applicationEnvironment = inject(ApplicationEnvironment);

  override viewSource(position: ElementPosition, directiveIndex: number): void {
    if (!this.applicationEnvironment.isConnectedToTopLevelFrame) {
      chrome.devtools.inspectedWindow.eval(
          `console.info('Console Utilities APIs are not available for non top level frames.')`)
      return;
    }

    if (chrome.devtools) {
      chrome.devtools.inspectedWindow.eval(
          `inspect(inspectedApplication.findConstructorByPosition('${position}', ${
              directiveIndex}))`);
    }
  }

  override selectDomElement(position: ElementPosition): void {
    if (!this.applicationEnvironment.isConnectedToTopLevelFrame) {
      chrome.devtools.inspectedWindow.eval(
          `console.info('Console Utilities APIs are not available for non top level frames.')`)
      return;
    }

    if (chrome.devtools) {
      chrome.devtools.inspectedWindow.eval(
          `inspect(inspectedApplication.findDomElementByPosition('${position}'))`);
    }
  }

  override inspect(directivePosition: DirectivePosition, objectPath: string[]): void {
    if (!this.applicationEnvironment.isConnectedToTopLevelFrame) {
      chrome.devtools.inspectedWindow.eval(
          `console.info('Console Utilities APIs are not available for non top level frames.')`)
      return;
    }

    if (chrome.devtools) {
      const args = {
        directivePosition,
        objectPath,
      };
      chrome.devtools.inspectedWindow.eval(
          `inspect(inspectedApplication.findPropertyByPosition('${JSON.stringify(args)}'))`);
    }
  }
}
