/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {ComponentExplorerViewQuery, DirectiveMetadata, DirectivesProperties, ElementPosition, NestedProp, PropertyQueryTypes, UpdatedStateData,} from 'protocol';

import {buildDirectiveTree, getLViewFromDirectiveOrElementInstance} from './directive-forest/index';
import {deeplySerializeSelectedProperties, getPropType, levelSerializer, nestedSerializer, serializeDirectiveState} from './state-serializer/state-serializer';

// Need to be kept in sync with Angular framework
// We can't directly import it from framework now
// because this also pulls up the security policies
// for Trusted Types, which we reinstantiate.
enum ChangeDetectionStrategy {
  OnPush = 0,
  Default = 1,
}

import {ComponentTreeNode, DirectiveInstanceType, ComponentInstanceType} from './interfaces';

const ngDebug = () => (window as any).ng;

export const getInjectorMetadataFromElement =
    (element: Node|undefined) => {
      let injectorMetadata = (window as any).ng?.getElementInjectorMetadata?.(element);
      if (injectorMetadata) {
        return injectorMetadata.map((injectorParameter: any, index: number) => {
          if (injectorParameter.token.ngMetadataName === 'InjectionToken') {
            return {
              token:
                  `${injectorParameter.token.constructor.name}(${injectorParameter.token._desc})`,
                  context: injectorParameter.context.factory.name,
                  value: injectorParameter?.value?.constructor?.name,
                  flags: injectorParameter.flags, paramIndex: index
            }
          }

          return {
            token: injectorParameter.token.name, context: injectorParameter.context.factory.name,
                value: injectorParameter.value.constructor.name, flags: injectorParameter.flags,
                paramIndex: index
          }
        });
      }
      return [];
    }

export const getLatestComponentState =
    (query: ComponentExplorerViewQuery, directiveForest?: ComponentTreeNode[]):
        [DirectivesProperties|undefined, any|undefined] => {
          // if a directive forest is passed in we don't have to build the forest again.
          directiveForest = directiveForest ?? buildDirectiveForest();

          const node = queryDirectiveForest(query.selectedElement, directiveForest);
          if (!node) {
            return [undefined, undefined];
          }

          const directivesProperties: DirectivesProperties = {};

          const populateResultSet = (dir: DirectiveInstanceType|ComponentInstanceType) => {
            if (query.propertyQuery.type === PropertyQueryTypes.All) {
              directivesProperties[dir.name] = {
                props: serializeDirectiveState(dir.instance),
                metadata: getDirectiveMetadata(dir.instance),
              };
            }

            if (query.propertyQuery.type === PropertyQueryTypes.Specified) {
              directivesProperties[dir.name] = {
                props: deeplySerializeSelectedProperties(
                    dir.instance, query.propertyQuery.properties[dir.name] || []),
                metadata: getDirectiveMetadata(dir.instance),
              };
            }
          };

          node.directives.forEach(populateResultSet);
          if (node.component) {
            populateResultSet(node.component);
          }

          let injectorMetadata = getInjectorMetadataFromElement(node.nativeElement!);

          return [directivesProperties, injectorMetadata];
        };

// Gets directive metadata. For newer versions of Angular (v12+) it uses
// the global `getDirectiveMetadata`. For prior versions of the framework
// the method directly interacts with the directive/component definition.
export const getDirectiveMetadata = (dir: any): DirectiveMetadata|undefined => {
  const metadata = (window as any).ng?.getDirectiveMetadata?.(dir);
  if (!metadata) {
    return;
  }

  const serializedMetadata = {
    inputs: metadata.inputs,
    outputs: metadata.outputs,
    encapsulation: metadata.encapsulation,
    onPush: metadata.changeDetection === ChangeDetectionStrategy.OnPush,
  };

  let injectorParameters = metadata.injectorParameters;
  if (injectorParameters) {
    injectorParameters = injectorParameters.map((injectorParameter: any, index: number) => {
      if (injectorParameter.flags.Attribute) {
        return {
          token: injectorParameter.token, value: injectorParameter.value,
              flags: injectorParameter.flags, paramIndex: index
        }
      }

      if (injectorParameter.flags.Inject) {
        return {
          token: injectorParameter.token.constructor.name,
              value: injectorParameter?.value?.constructor?.name, flags: injectorParameter.flags,
              paramIndex: index
        }
      }

      return {
        token: injectorParameter.token.name, value: injectorParameter.value.constructor.name,
            flags: injectorParameter.flags, paramIndex: index
      }
    });
    serializedMetadata['injectorParameters'] = injectorParameters;
  }

  return serializedMetadata;
};

const getRootLViewsHelper = (element: Element, rootLViews = new Set<any>()): Set<any> => {
  if (!(element instanceof HTMLElement)) {
    return rootLViews;
  }
  const lView = getLViewFromDirectiveOrElementInstance(element);
  if (lView) {
    rootLViews.add(lView);
    return rootLViews;
  }
  // tslint:disable-next-line: prefer-for-of
  for (let i = 0; i < element.children.length; i++) {
    getRootLViewsHelper(element.children[i], rootLViews);
  }
  return rootLViews;
};

const getRoots = () => {
  const roots =
      Array.from(document.documentElement.querySelectorAll('[ng-version]')) as HTMLElement[];

  const isTopLevel = (element: HTMLElement) => {
    let parent: HTMLElement|null = element;

    while (parent?.parentElement) {
      parent = parent.parentElement;
      if (parent.hasAttribute('ng-version')) {
        return false;
      }
    }

    return true;
  };

  return roots.filter(isTopLevel);
};

export const buildDirectiveForest = (): ComponentTreeNode[] => {
  const roots = getRoots();
  return Array.prototype.concat.apply([], Array.from(roots).map(buildDirectiveTree));
};

// Based on an ElementID we return a specific component node.
// If we can't find any, we return null.
export const queryDirectiveForest =
    (position: ElementPosition, forest: ComponentTreeNode[]): ComponentTreeNode|null => {
      if (!position.length) {
        return null;
      }
      let node: null|ComponentTreeNode = null;
      for (const i of position) {
        node = forest[i];
        if (!node) {
          return null;
        }
        forest = node.children;
      }
      return node;
    };

export const findNodeInForest =
    (position: ElementPosition, forest: ComponentTreeNode[]): HTMLElement|null => {
      const foundComponent: ComponentTreeNode|null = queryDirectiveForest(position, forest);
      return foundComponent ? (foundComponent.nativeElement as HTMLElement) : null;
    };

export const findNodeFromSerializedPosition =
    (serializedPosition: string): ComponentTreeNode|null => {
      const position: number[] = serializedPosition.split(',').map((index) => parseInt(index, 10));
      return queryDirectiveForest(position, buildDirectiveForest());
    };

export const updateState = (updatedStateData: UpdatedStateData): void => {
  const ngd = ngDebug();
  const node = queryDirectiveForest(updatedStateData.directiveId.element, buildDirectiveForest());
  if (!node) {
    console.warn(
        'Could not update the state of component', updatedStateData,
        'because the component was not found');
    return;
  }
  if (updatedStateData.directiveId.directive !== undefined) {
    const directive = node.directives[updatedStateData.directiveId.directive].instance;
    mutateComponentOrDirective(updatedStateData, directive);
    ngd.applyChanges(ngd.getOwningComponent(directive));
    return;
  }
  if (node.component) {
    const comp = node.component.instance;
    mutateComponentOrDirective(updatedStateData, comp);
    ngd.applyChanges(comp);
    return;
  }
};

const mutateComponentOrDirective = (updatedStateData: UpdatedStateData, compOrDirective: any) => {
  const valueKey = updatedStateData.keyPath.pop();
  if (valueKey === undefined) {
    return;
  }

  let parentObjectOfValueToUpdate = compOrDirective;
  updatedStateData.keyPath.forEach((key) => {
    parentObjectOfValueToUpdate = parentObjectOfValueToUpdate[key];
  });

  // When we try to set a property which only has a getter
  // the line below could throw an error.
  try {
    parentObjectOfValueToUpdate[valueKey] = updatedStateData.newValue;
  } catch {
  }
};
