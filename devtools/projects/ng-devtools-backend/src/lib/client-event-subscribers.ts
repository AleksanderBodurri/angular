/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {ComponentExplorerViewQuery, ComponentType, DevToolsNode, DirectivePosition, DirectiveType, ElementPosition, Events, MessageBus, ProfilerFrame,} from 'protocol';
import {debounceTime} from 'rxjs/operators';

import {appIsAngularInDevMode, appIsAngularIvy, appIsSupportedAngularVersion, getAngularVersion,} from './angular-check';
import {ComponentInspector} from './component-inspector/component-inspector';
import {getLatestComponentState, queryDirectiveForest, serializeInjectorParameter, updateState} from './component-tree';
import {unHighlight} from './highlighter';
import {disableTimingAPI, enableTimingAPI, initializeOrGetDirectiveForestHooks} from './hooks';
import {start as startProfiling, stop as stopProfiling} from './hooks/capture';
import {IndexedNode} from './hooks/identity-tracker';
import {setConsoleReference} from './set-console-reference';
import {serializeDirectiveState} from './state-serializer/state-serializer';
import {runOutsideAngular} from './utils';

enum InjectFlags {
  Default = 0b0000,
  Host = 0b0001,
  Self = 0b0010,
  SkipSelf = 0b0100,
  Optional = 0b1000,
}

function stringify(token: any): string {
  if (typeof token === 'string') {
    return token;
  }

  if (Array.isArray(token)) {
    return '[' + token.map(stringify).join(', ') + ']';
  }

  if (token == null) {
    return '' + token;
  }

  if (token.overriddenName) {
    return `${token.overriddenName}`;
  }

  if (token.name) {
    return `${token.name}`;
  }

  if (!token.toString) {
    return 'object';
  }

  // WARNING: do not try to `JSON.stringify(token)` here
  // see https://github.com/angular/angular/issues/23440
  const res = token.toString();

  if (res == null) {
    return '' + res;
  }

  const newLineIndex = res.indexOf('\n');
  return newLineIndex === -1 ? res : res.substring(0, newLineIndex);
}

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

  // hackathon mode function, needs rewrite
  // Limitations:
  // Can only grab dependencies of element injector providers where the provider
  // is initialized in the context of the element injector
  // Cna only grab ctorParameters of ngModules. inject not supported
  messageBus.on('getProviders', ({injector}) => {
    const injectorMapValues = injectorMap.entries();
    const ng = window.ng as any;

    let providersForInjector: any = [];

    while (true) {
      const {value, done} = injectorMapValues.next();

      if (done) {
        break;
      }

      const [owner, id] = value;

      if (id === injector.id) {
        if (injector.type === 'Element') {
          let directives: any[] = [];
          if (injector.node.component) {
            try {
              directives.push(ng.getComponent(owner).constructor);
            } catch {
            }
          }

          if (injector.node.directives.length > 0) {
            directives.push(...ng.getDirectives(owner).map(d => d.constructor));
          }

          let debugNode = ng.getDebugNode(owner);
          let {providers, viewProviders} = debugNode.injector;
          providers = providers.filter(
              provider => provider.type === undefined || !directives.includes(provider.type));
          viewProviders = viewProviders.filter(
              provider => provider.type === undefined || !directives.includes(provider.type));
          providers = [...providers, ...viewProviders].map(provider => {
            if (provider.provide) {
              return provider.provide;
            }

            return provider;
          });


          const elementInjectorMetadata = ng.getElementInjectorMetadata(owner);

          providers.forEach(provider => {
            const foundServiceIndex =
                elementInjectorMetadata.findIndex(service => service.token === provider);
            const foundService = elementInjectorMetadata?.[foundServiceIndex];
            if (foundService) {
              const dependencies: any[] = [];
              elementInjectorMetadata.forEach((service, index) => {
                if (service.context.factory === foundService?.token?.ɵprov?.factory) {
                  const resolutionPath = ng.traceTokenInjectorPath(owner, service.token);

                  serializeResolutionPath(resolutionPath);

                  dependencies.push(
                      {...serializeInjectorParameter(service, index), resolutionPath});
                }
              });

              providersForInjector.push({
                provider: stringify(provider),
                service: serializeInjectorParameter(foundService, foundServiceIndex),
                dependencies
              });
            } else {
              providersForInjector.push({
                provider: stringify(provider),
              });
            }
          });

        } else {
          const containerProviders = ng.getContainerProviders(owner).map(provider => {
            if (provider.provide) {
              return provider.provide;
            }

            return provider;
          });

          const containerInstance = containerInjectorIdToInstance.get(id);
          const NOT_FOUND = {};

          const injectorMetadata = ng.getInjectorMetadata(containerInstance);

          containerProviders.forEach(provider => {
            const foundServiceIndex =
                injectorMetadata.findIndex(service => service.token === provider);
            const foundService = injectorMetadata?.[foundServiceIndex];

            const reifiedValue =
                containerInstance.get(provider, NOT_FOUND, InjectFlags.Self | InjectFlags.Optional);

            if (reifiedValue !== NOT_FOUND) {
              const ctorParameters = reifiedValue.constructor?.ctorParameters?.() ?? [];
              const dependencies: any[] = [];
              ctorParameters.forEach(param => {
                if ('type' in param && param.type === undefined) {
                  return;
                }

                const token = param.type || param;
                if (!token) {
                  return;
                }

                const resolutionPath = ng.traceTokenResolutionPath(token, containerInstance);
                serializeResolutionPath(resolutionPath);

                dependencies.push({token: stringify(token), resolutionPath});
              });

              if (ctorParameters.length === 0) {
                providersForInjector.push({
                  provider: stringify(provider),
                });
              } else {
                providersForInjector.push({provider: stringify(provider), dependencies});
              }
            } else {
              providersForInjector.push({
                provider: stringify(provider),
              });
            }
          });
        }

        break;
      }
    }

    messageBus.emit('receiveProviders', [providersForInjector]);
  });

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
  injectorMap.clear();

  const t0 = performance.now();
  const forestWithInjectorPaths =
      prepareForestForSerialization(
          initializeOrGetDirectiveForestHooks().getIndexedDirectiveForest(), true) as any;
  const t1 = performance.now();
  console.log(`Injector Tree ${t1 - t0} milliseconds.`);
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

const getLatestComponentExplorerViewCallback = (messageBus: MessageBus<Events>) => (
    query?: ComponentExplorerViewQuery) => {
  // We want to force re-indexing of the component tree.
  // Pressing the refresh button means the user saw stuck UI.
  initializeOrGetDirectiveForestHooks().indexForest();

  injectorMap.clear();

  const t0 = performance.now();
  const forest =
      prepareForestForSerialization(
          initializeOrGetDirectiveForestHooks().getIndexedDirectiveForest(), true) as any;
  messageBus.emit('latestInjectorGraphView', [forest]);
  const t1 = performance.now();
  console.log(`Injector Tree took ${t1 - t0} milliseconds.`);

  if (!query) {
    messageBus.emit('latestComponentExplorerView', [{forest}]);
    return;
  }

  const [properties, injector] =
      getLatestComponentState(query, initializeOrGetDirectiveForestHooks().getDirectiveForest());

  injector.forEach(parameter => {
    const node = queryDirectiveForest(
        query.selectedElement, initializeOrGetDirectiveForestHooks().getIndexedDirectiveForest());
    if (node === null) {
      console.error(`Cannot find element associated with node ${query.selectedElement}`);
      return undefined;
    }

    const elementInjectorMetadata =
        (window as any).ng.getElementInjectorMetadata(node.nativeElement)
    const foundParameter = elementInjectorMetadata[parameter.paramIndex];

    const resolutionPath =
        (window as any)?.ng.traceTokenInjectorPath(node.nativeElement, foundParameter.token);

    serializeResolutionPath(resolutionPath);

    parameter.resolutionPath = resolutionPath;
  });


  messageBus.emit('latestComponentExplorerView', [
    {forest, properties, injector},
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

const serializeResolutionPath = (injectors: any[]) => {
  (injectors ?? []).forEach(injector => {
    injector.owner = injector.owner.name || injector.owner.ngModule.name;
    if (injector.type === 'Module' || injector.type === 'ImportedModule' && injector.importPath) {
      serializeResolutionPath(injector.importPath);
    }
  });
};

const traceInjectorParameterResolutionPathCallback =
    (messageBus: MessageBus<Events>) => (
        directivePosition: any,
        injectorParameter: any,
        ) => {
      const node = queryDirectiveForest(
          directivePosition, initializeOrGetDirectiveForestHooks().getIndexedDirectiveForest());
      if (node === null) {
        console.error(`Cannot find element associated with node ${directivePosition}`);
        return undefined;
      }

      const elementInjectorMetadata =
          (window as any).ng.getElementInjectorMetadata(node.nativeElement)
      const foundParameter = elementInjectorMetadata[injectorParameter.paramIndex];

      const resolutionPath =
          (window as any)?.ng.traceTokenInjectorPath(node.nativeElement, foundParameter.token);

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


const getInjectorResolutionPath = (element: Node|undefined) => {
  return (window as any).ng.getInjectorResolutionPath(element);
};
const getDirectives = (element: Node|undefined) => {
  return (window as any).ng.getDirectives(element);
};
const getComponent =
    (element: Node|undefined) => {
      return (window as any).ng.getComponent(element);
    }

const injectorMap = new Map();
const containerInjectorIdToInstance = new Map();

// Here we drop properties to prepare the tree for serialization.
// We don't need the component instance, so we just traverse the tree
// and leave the component name.
const prepareForestForSerialization =
    (roots: IndexedNode[], includeResolutionPath = false): SerializableComponentTreeNode[] => {
      return roots.map((node) => {
        const serializedNode = {
          position: node.position,
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
            if (injectorMap.has(injector.owner)) {
              injector.id = injectorMap.get(injector.owner);
            } else {
              const uuid = crypto.randomUUID();
              injectorMap.set(injector.owner, uuid);
              injector.id = uuid;
            }

            if (injector.type === 'Element') {
              let directives = getDirectives(injector.owner);
              if (!(injector.owner instanceof Comment)) {
                directives =
                    [getComponent(injector.owner), ...directives].filter(directive => !!directive);
              }

              const [firstDirective, ...restOfDirectives] = directives.map(d => d.constructor.name);
              injector.owner = restOfDirectives.length === 0 ?
                  firstDirective :
                  `${firstDirective}[${restOfDirectives.join(', ')}]`;
            } else {
              containerInjectorIdToInstance.set(injector.id, injector.instance);

              delete injector.instance;
              injector.owner = injector.owner.name;
            }
          }

          serializedNode['resolutionPath'] = resolutionPath;
        }

        return serializedNode;
      });
    };
