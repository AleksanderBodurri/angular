/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {ComponentExplorerViewQuery, ComponentType, DevToolsNode, DirectivePosition, DirectiveType, ElementPosition, Events, InjectorGraphViewQuery, MessageBus, ProfilerFrame,} from 'protocol';
import {debounceTime} from 'rxjs/operators';

import {appIsAngularInDevMode, appIsAngularIvy, appIsSupportedAngularVersion, getAngularVersion,} from './angular-check';
import {ComponentInspector} from './component-inspector/component-inspector';
import {getLatestComponentState, queryDirectiveForest, updateState} from './component-tree';
import {unHighlight} from './highlighter';
import {disableTimingAPI, enableTimingAPI, initializeOrGetDirectiveForestHooks} from './hooks';
import {start as startProfiling, stop as stopProfiling} from './hooks/capture';
import {ComponentTreeNode} from './interfaces';
import {setConsoleReference} from './set-console-reference';
import {serializeDirectiveState} from './state-serializer/state-serializer';
import {runOutsideAngular} from './utils';

export const subscribeToClientEvents = (messageBus: MessageBus<Events>): void => {
  messageBus.on('shutdown', shutdownCallback(messageBus));

  messageBus.on(
      'getLatestComponentExplorerView', getLatestComponentExplorerViewCallback(messageBus));

  messageBus.on('getLatestInjectorGraphView', getLatestInjectorGraphCallback(messageBus));
  messageBus.on(
      'traceInjectorParameterResolutionPath',
      traceInjectorParameterResolutionPathCallback(messageBus));

  messageBus.on('queryNgAvailability', checkForAngularCallback(messageBus));

  messageBus.on('startProfiling', startProfilingCallback(messageBus));
  messageBus.on('stopProfiling', stopProfilingCallback(messageBus));

  messageBus.on('setSelectedComponent', selectedComponentCallback);

  messageBus.on('getNestedProperties', getNestedPropertiesCallback(messageBus));
  messageBus.on('getRoutes', getRoutesCallback(messageBus));

  messageBus.on('updateState', updateState);

  messageBus.on('enableTimingAPI', enableTimingAPI);
  messageBus.on('disableTimingAPI', disableTimingAPI);

  if (appIsAngularInDevMode() && appIsSupportedAngularVersion() && appIsAngularIvy()) {
    setupInspector(messageBus);
    // Often websites have `scroll` event listener which triggers
    // Angular's change detection. We don't want to constantly send
    // update requests, instead we want to request an update at most
    // once every 250ms
    runOutsideAngular(() => {
      initializeOrGetDirectiveForestHooks()
          .profiler.changeDetection$.pipe(debounceTime(250))
          .subscribe(() => messageBus.emit('componentTreeDirty'));
    });
  }
};

//
// Callback Definitions
//

const getLatestInjectorGraphCallback = (messageBus: MessageBus<Events>) => () => {
  const forestWithInjectorPaths =
      prepareForestForSerialization(
          initializeOrGetDirectiveForestHooks().getIndexedDirectiveForest(), true) as any;
  messageBus.emit('latestInjectorGraphView', [forestWithInjectorPaths]);
};

export interface InjectorGraphNode {
  owner: string;
  type: string;
  children: InjectorGraphNode[]
}

const shutdownCallback = (messageBus: MessageBus<Events>) => () => {
  messageBus.destroy();
};

const getLatestComponentExplorerViewCallback = (messageBus: MessageBus<Events>) =>
    (query?: ComponentExplorerViewQuery) => {
      // We want to force re-indexing of the component tree.
      // Pressing the refresh button means the user saw stuck UI.
      initializeOrGetDirectiveForestHooks().indexForest();

      if (!query) {
        messageBus.emit('latestComponentExplorerView', [
          {
            forest: prepareForestForSerialization(
                initializeOrGetDirectiveForestHooks().getIndexedDirectiveForest()),
          },
        ]);
        return;
      }

      messageBus.emit('latestComponentExplorerView', [
        {
          forest: prepareForestForSerialization(
              initializeOrGetDirectiveForestHooks().getIndexedDirectiveForest()),
          properties: getLatestComponentState(
              query, initializeOrGetDirectiveForestHooks().getDirectiveForest()),
        },
      ]);
    };

const checkForAngularCallback = (messageBus: MessageBus<Events>) => () =>
    checkForAngular(messageBus);
const getRoutesCallback = (messageBus: MessageBus<Events>) => () => getRoutes(messageBus);

const startProfilingCallback = (messageBus: MessageBus<Events>) => () =>
    startProfiling((frame: ProfilerFrame) => {
      messageBus.emit('sendProfilerChunk', [frame]);
    });

const stopProfilingCallback = (messageBus: MessageBus<Events>) => () => {
  messageBus.emit('profilerResults', [stopProfiling()]);
};

const selectedComponentCallback = (position: ElementPosition) => {
  const node = queryDirectiveForest(
      position, initializeOrGetDirectiveForestHooks().getIndexedDirectiveForest());
  setConsoleReference({node, position});
};

const getNestedPropertiesCallback = (messageBus: MessageBus<Events>) => (
    position: DirectivePosition, propPath: string[]) => {
  const emitEmpty = () => messageBus.emit('nestedProperties', [position, {props: {}}, propPath]);
  const node = queryDirectiveForest(
      position.element, initializeOrGetDirectiveForestHooks().getIndexedDirectiveForest());
  if (!node) {
    return emitEmpty();
  }
  const current =
      position.directive === undefined ? node.component : node.directives[position.directive];
  if (!current) {
    return emitEmpty();
  }
  let data = current.instance;
  for (const prop of propPath) {
    data = data[prop];
    if (!data) {
      console.error('Cannot access the properties', propPath, 'of', node);
    }
  }
  messageBus.emit('nestedProperties', [position, {props: serializeDirectiveState(data)}, propPath]);
};

const traceInjectorParameterResolutionPathCallback =
    (messageBus: MessageBus<Events>) => (
        directivePosition: any,
        injectorParameter: any,
        ) => {
      const node = queryDirectiveForest(
          directivePosition.element,
          initializeOrGetDirectiveForestHooks().getIndexedDirectiveForest());
      if (node === null) {
        console.error(`Cannot find element associated with node ${directivePosition}`);
        return undefined;
      }

      const isDirective = directivePosition.directive !== undefined &&
          node.directives[directivePosition.directive] &&
          typeof node.directives[directivePosition.directive] === 'object';

      const instance = isDirective ? node.directives[directivePosition.directive].instance :
                                     node.component?.instance;
      if (!instance) {
        return;
      }
      const foundParameter = (window as any)
                                 ?.ng.getDirectiveMetadata(instance)
                                 ?.injectorParameters[injectorParameter.paramIndex];

      const resolutionPath =
          (window as any)?.ng.traceTokenInjectorPath(node.nativeElement, foundParameter.token);

      const serializeResolutionPath = (injectors: any[]) => {
        (injectors ?? []).forEach(injector => {
          injector.owner = injector.owner.name;
          if (injector.type === 'Module' ||
              injector.type === 'ImportedModule' && injector.importPath) {
            serializeResolutionPath(injector.importPath);
          }
        });
      };

      serializeResolutionPath(resolutionPath);

      messageBus.emit('injectorParameterResolutionPath', [resolutionPath]);
    }

//
// Subscribe Helpers
//

// todo: parse router tree with framework APIs after they are developed
const getRoutes = (messageBus: MessageBus<Events>) => {
  // Return empty router tree to disable tab.
  messageBus.emit('updateRouterTree', [[]]);
};

const checkForAngular = (messageBus: MessageBus<Events>): void => {
  const ngVersion = getAngularVersion();
  const appIsIvy = appIsAngularIvy();
  if (!ngVersion) {
    setTimeout(() => checkForAngular(messageBus), 500);
    return;
  }

  if (appIsIvy && appIsAngularInDevMode() && appIsSupportedAngularVersion()) {
    initializeOrGetDirectiveForestHooks();
  }

  messageBus.emit('ngAvailability', [
    {version: ngVersion.toString(), devMode: appIsAngularInDevMode(), ivy: appIsIvy},
  ]);
};

const setupInspector = (messageBus: MessageBus<Events>) => {
  const inspector = new ComponentInspector({
    onComponentEnter: (id: number) => {
      messageBus.emit('highlightComponent', [id]);
    },
    onComponentLeave: () => {
      messageBus.emit('removeComponentHighlight');
    },
    onComponentSelect: (id: number) => {
      messageBus.emit('selectComponent', [id]);
    },
  });

  messageBus.on('inspectorStart', inspector.startInspecting);
  messageBus.on('inspectorEnd', inspector.stopInspecting);

  messageBus.on('createHighlightOverlay', (position: ElementPosition) => {
    inspector.highlightByPosition(position);
  });
  messageBus.on('removeHighlightOverlay', unHighlight);
};

export interface SerializableDirectiveInstanceType extends DirectiveType {
  id: number;
}

export interface SerializableComponentInstanceType extends ComponentType {
  id: number;
}

export interface SerializableComponentTreeNode extends
    DevToolsNode<SerializableDirectiveInstanceType, SerializableComponentInstanceType> {
  children: SerializableComponentTreeNode[];
}


const getInjectorResolutionPath =
    (element: Node|undefined) => {
      return (window as any).ng.getInjectorResolutionPath(element);
    }

// Here we drop properties to prepare the tree for serialization.
// We don't need the component instance, so we just traverse the tree
// and leave the component name.
const prepareForestForSerialization = (roots: ComponentTreeNode[], includeResolutionPath = false):
    SerializableComponentTreeNode[] => {
      return roots.map((node) => {
        const serializedNode = {
          element: node.element,
          component: node.component ? {
            name: node.component.name,
            isElement: node.component.isElement,
            id: initializeOrGetDirectiveForestHooks().getDirectiveId(node.component.instance),
          } :
                                      null,
          directives: node.directives.map(
              (d) => ({
                name: d.name,
                id: initializeOrGetDirectiveForestHooks().getDirectiveId(d.instance),
              })),
          children: prepareForestForSerialization(node.children, includeResolutionPath),
        } as SerializableComponentTreeNode;

        if (includeResolutionPath) {
          const resolutionPath: any[] = getInjectorResolutionPath(node.nativeElement);
          for (const injector of resolutionPath) {
            injector.owner = injector.owner.name;
          }
          serializedNode['resolutionPath'] = resolutionPath;
        }

        return serializedNode;
      });
    };
