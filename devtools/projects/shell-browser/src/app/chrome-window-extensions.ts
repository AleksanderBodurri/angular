/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {findNodeFromSerializedPosition} from 'ng-devtools-backend';

import {buildDirectiveForest, queryDirectiveForest} from '../../../ng-devtools-backend/src/lib/component-tree';

export const initializeExtendedWindowOperations = () => {
  extendWindowOperations(window, {inspectedApplication: chromeWindowExtensions});
};

const extendWindowOperations = <T extends {}>(target, classImpl: T) => {
  for (const key of Object.keys(classImpl)) {
    if (target[key] != null) {
      console.warn(`A window function or object named ${key} would be overwritten`);
    }
  }

  Object.assign(target, classImpl);
};

const chromeWindowExtensions = {
  findConstructorByPosition: (serializedId: string): Element | undefined => {
    const node = findNodeFromSerializedPosition(serializedId);
    if (node === null) {
      console.error(`Cannot find element associated with node ${serializedId}`);
      return;
    }
    if (node.component) {
      return node.component.instance.constructor;
    } else {
      console.error('This component has no instance and therefore no constructor');
    }
  },
  findDomElementByPosition: (serializedId: string): Node | undefined => {
    const node = findNodeFromSerializedPosition(serializedId);
    if (node === null) {
      console.error(`Cannot find element associated with node ${serializedId}`);
      return undefined;
    }
    return node.nativeElement;
  },
  findPropertyByPosition: (args): any => {
    const {directivePosition, objectPath} = JSON.parse(args);
    const node = queryDirectiveForest(directivePosition.element, buildDirectiveForest());
    if (node === null) {
      console.error(`Cannot find element associated with node ${directivePosition}`);
      return undefined;
    }

    const isDirective = directivePosition.directive !== undefined &&
        node.directives[directivePosition.directive] &&
        typeof node.directives[directivePosition.directive] === 'object';
    if (isDirective) {
      return traverseDirective(node.directives[directivePosition.directive].instance, objectPath);
    }
    if (node.component) {
      return traverseDirective(node.component.instance, objectPath);
    }
  },
  findInjector(args) {
    const {directivePosition, injectorParameter, injectorPosition} = JSON.parse(args);
    const node = queryDirectiveForest(directivePosition, buildDirectiveForest());
    if (node === null) {
      console.error(`Cannot find element associated with node ${directivePosition}`);
      return undefined;
    }

    const elementInjectorMetadata =
        (window as any).ng.getElementInjectorMetadata(node.nativeElement)
    const foundParameter = elementInjectorMetadata[injectorParameter.paramIndex];

    const resolutionPath =
        (window as any)?.ng.traceTokenInjectorPath(node.nativeElement, foundParameter.token);

    let injector;
    if (injectorPosition.length == 2) {
      injector =
          resolutionPath.slice().reverse()[injectorPosition[0]].importPath[injectorPosition[1] + 1]
    } else {
      injector = resolutionPath.slice().reverse()[injectorPosition[0]];
    }

    console.log(injector);
    return injector.owner;
  }
};

const traverseDirective = (dir: any, objectPath: string[]): any => {
  for (const key of objectPath) {
    if (!dir[key]) {
      return;
    }
    dir = dir[key];
  }
  return dir;
};
