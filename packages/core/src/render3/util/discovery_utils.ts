/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {ChangeDetectionStrategy} from '../../change_detection/constants';
import {InjectFlags, NgModuleRef as viewEngine_NgModuleRef, Provider, Type} from '../../core';
import {Injector} from '../../di/injector';
import {getInjectorDef} from '../../di/interface/defs';
import {NullInjector} from '../../di/null_injector';
import {walkProviderTree} from '../../di/provider_collection';
import {ViewEncapsulation} from '../../metadata/view';
import {deepForEach} from '../../util/array_utils';
import {assertEqual} from '../../util/assert';
import {assertLView, assertNodeInjector} from '../assert';
import {discoverLocalRefs, findViaComponent, findViaDirective, findViaNativeElement, getComponentAtNodeIndex, getDirectivesAtNodeIndex, getLContext, readPatchedLView} from '../context_discovery';
import {getComponentDef, getDirectiveDef} from '../definition';
import {getInjectorIndex, getParentInjectorLocation, injectAttributeImpl, NodeInjector} from '../di';
import {buildDebugNode} from '../instructions/lview_debug';
import {DirectiveDef} from '../interfaces/definition';
import {NO_PARENT_INJECTOR, NodeInjectorOffset} from '../interfaces/injector';
import {TElementNode, TNode, TNodeProviderIndexes} from '../interfaces/node';
import {RElement} from '../interfaces/renderer_dom';
import {isLView} from '../interfaces/type_checks';
import {CLEANUP, CONTEXT, DebugNode, FLAGS, INJECTOR, LView, LViewFlags, RootContext, T_HOST, TVIEW, TViewType} from '../interfaces/view';
import {NgModuleRef} from '../ng_module_ref';

import {getParentInjectorIndex, getParentInjectorView} from './injector_utils';
import {stringifyForError} from './stringify_utils';
import {getLViewParent, getRootContext} from './view_traversal_utils';
import {getTNode, unwrapRNode} from './view_utils';


/**
 * Retrieves the component instance associated with a given DOM element.
 *
 * @usageNotes
 * Given the following DOM structure:
 *
 * ```html
 * <app-root>
 *   <div>
 *     <child-comp></child-comp>
 *   </div>
 * </app-root>
 * ```
 *
 * Calling `getComponent` on `<child-comp>` will return the instance of `ChildComponent`
 * associated with this DOM element.
 *
 * Calling the function on `<app-root>` will return the `MyApp` instance.
 *
 *
 * @param element DOM element from which the component should be retrieved.
 * @returns Component instance associated with the element or `null` if there
 *    is no component associated with it.
 *
 * @publicApi
 * @globalApi ng
 */
export function getComponent<T>(element: Element): T|null {
  ngDevMode && assertDomElement(element);
  const context = getLContext(element);
  if (context === null) return null;

  if (context.component === undefined) {
    const lView = context.lView;
    if (lView === null) {
      return null;
    }
    context.component = getComponentAtNodeIndex(context.nodeIndex, lView);
  }

  return context.component as unknown as T;
}


/**
 * If inside an embedded view (e.g. `*ngIf` or `*ngFor`), retrieves the context of the embedded
 * view that the element is part of. Otherwise retrieves the instance of the component whose view
 * owns the element (in this case, the result is the same as calling `getOwningComponent`).
 *
 * @param element Element for which to get the surrounding component instance.
 * @returns Instance of the component that is around the element or null if the element isn't
 *    inside any component.
 *
 * @publicApi
 * @globalApi ng
 */
export function getContext<T extends({} | RootContext)>(element: Element): T|null {
  assertDomElement(element);
  const context = getLContext(element)!;
  const lView = context ? context.lView : null;
  return lView === null ? null : lView[CONTEXT] as T;
}

/**
 * Retrieves the component instance whose view contains the DOM element.
 *
 * For example, if `<child-comp>` is used in the template of `<app-comp>`
 * (i.e. a `ViewChild` of `<app-comp>`), calling `getOwningComponent` on `<child-comp>`
 * would return `<app-comp>`.
 *
 * @param elementOrDir DOM element, component or directive instance
 *    for which to retrieve the root components.
 * @returns Component instance whose view owns the DOM element or null if the element is not
 *    part of a component view.
 *
 * @publicApi
 * @globalApi ng
 */
export function getOwningComponent<T>(elementOrDir: Element|{}): T|null {
  const context = getLContext(elementOrDir)!;
  let lView = context ? context.lView : null;
  if (lView === null) return null;

  let parent: LView|null;
  while (lView[TVIEW].type === TViewType.Embedded && (parent = getLViewParent(lView)!)) {
    lView = parent;
  }
  return lView[FLAGS] & LViewFlags.IsRoot ? null : lView[CONTEXT] as unknown as T;
}

/**
 * Retrieves all root components associated with a DOM element, directive or component instance.
 * Root components are those which have been bootstrapped by Angular.
 *
 * @param elementOrDir DOM element, component or directive instance
 *    for which to retrieve the root components.
 * @returns Root components associated with the target object.
 *
 * @publicApi
 * @globalApi ng
 */
export function getRootComponents(elementOrDir: Element|{}): {}[] {
  const lView = readPatchedLView<{}>(elementOrDir);
  return lView !== null ? [...getRootContext(lView).components as unknown as {}[]] : [];
}

/**
 * Retrieves an `Injector` associated with an element, component or directive instance.
 *
 * @param elementOrDir DOM element, component or directive instance for which to
 *    retrieve the injector.
 * @returns Injector associated with the element, component or directive instance.
 *
 * @publicApi
 * @globalApi ng
 */
export function getInjector(elementOrDir: Element|{}): Injector {
  const context = getLContext(elementOrDir)!;
  const lView = context ? context.lView : null;
  if (lView === null) return Injector.NULL;

  const tNode = lView[TVIEW].data[context.nodeIndex] as TElementNode;
  return new NodeInjector(tNode, lView);
}

/**
 * Retrieve a set of injection tokens at a given DOM node.
 *
 * @param element Element for which the injection tokens should be retrieved.
 */
export function getInjectionTokens(element: Element): any[] {
  const context = getLContext(element)!;
  const lView = context ? context.lView : null;
  if (lView === null) return [];
  const tView = lView[TVIEW];
  const tNode = tView.data[context.nodeIndex] as TNode;
  const providerTokens: any[] = [];
  const startIndex = tNode.providerIndexes & TNodeProviderIndexes.ProvidersStartIndexMask;
  const endIndex = tNode.directiveEnd;
  for (let i = startIndex; i < endIndex; i++) {
    let value = tView.data[i];
    if (isDirectiveDefHack(value)) {
      // The fact that we sometimes store Type and sometimes DirectiveDef in this location is a
      // design flaw.  We should always store same type so that we can be monomorphic. The issue
      // is that for Components/Directives we store the def instead the type. The correct behavior
      // is that we should always be storing injectable type in this location.
      value = value.type;
    }
    providerTokens.push(value);
  }
  return providerTokens;
}

/**
 * Retrieves directive instances associated with a given DOM node. Does not include
 * component instances.
 *
 * @usageNotes
 * Given the following DOM structure:
 *
 * ```html
 * <app-root>
 *   <button my-button></button>
 *   <my-comp></my-comp>
 * </app-root>
 * ```
 *
 * Calling `getDirectives` on `<button>` will return an array with an instance of the `MyButton`
 * directive that is associated with the DOM node.
 *
 * Calling `getDirectives` on `<my-comp>` will return an empty array.
 *
 * @param node DOM node for which to get the directives.
 * @returns Array of directives associated with the node.
 *
 * @publicApi
 * @globalApi ng
 */
export function getDirectives(node: Node): {}[] {
  // Skip text nodes because we can't have directives associated with them.
  if (node instanceof Text) {
    return [];
  }

  const context = getLContext(node)!;
  const lView = context ? context.lView : null;
  if (lView === null) {
    return [];
  }

  const tView = lView[TVIEW];
  const nodeIndex = context.nodeIndex;
  if (!tView?.data[nodeIndex]) {
    return [];
  }
  if (context.directives === undefined) {
    context.directives = getDirectivesAtNodeIndex(nodeIndex, lView, false);
  }

  // The `directives` in this case are a named array called `LComponentView`. Clone the
  // result so we don't expose an internal data structure in the user's console.
  return context.directives === null ? [] : [...context.directives];
}

/**
 * Partial metadata for a given directive instance.
 * This information might be useful for debugging purposes or tooling.
 * Currently only `inputs` and `outputs` metadata is available.
 *
 * @publicApi
 */
export interface DirectiveDebugMetadata {
  inputs: Record<string, string>;
  outputs: Record<string, string>;
  injectorParameters: any[]
}

/**
 * Partial metadata for a given component instance.
 * This information might be useful for debugging purposes or tooling.
 * Currently the following fields are available:
 *  - inputs
 *  - outputs
 *  - encapsulation
 *  - changeDetection
 *
 * @publicApi
 */
export interface ComponentDebugMetadata extends DirectiveDebugMetadata {
  encapsulation: ViewEncapsulation;
  changeDetection: ChangeDetectionStrategy;
}

function ctorParametersMetadata(directiveOrComponentInstance: any, isComponent = false) {
  const {constructor} = directiveOrComponentInstance;
  if (!constructor) {
    throw new Error('Unable to find the instance constructor');
  }

  if (constructor.ctorParameters === undefined) {
    return [];
  }

  const context = getLContext(directiveOrComponentInstance);
  if (context === null) {
    throw new Error('Cannot determine context from directive instance.');
  };
  const nodeIndex = (isComponent ? findViaComponent : findViaDirective)(
      context.lView!, directiveOrComponentInstance);
  const tView = context.lView![TVIEW];
  const tNode = tView.data[nodeIndex] as TNode;

  const injector = getInjector(directiveOrComponentInstance);
  const ctorParameters = constructor?.ctorParameters?.() ?? [];

  return ctorParameters.map((parameter: any) => {
    const flags: {
      Attribute: boolean; Inject: boolean; Self: boolean; SkipSelf: boolean; Host: boolean;
      Optional: boolean;
    } = {
      Attribute: false,
      Inject: false,
      Self: false,
      SkipSelf: false,
      Host: false,
      Optional: false
    };

    let injectionFlags = InjectFlags.Default;
    let token = parameter.type;

    for (const decorator of (parameter.decorators ?? [])) {
      const name = decorator.type.prototype.ngMetadataName as 'Attribute' | 'Inject' | 'Self' |
          'SkipSelf' | 'Host' | 'Optional' | undefined;

      if (name === undefined) {
        continue;
      }

      flags[name] = true;

      if (name === 'Attribute' || name === 'Inject') {
        token = decorator.args[0];
      }

      if (name === 'Self') {
        injectionFlags |= InjectFlags.Self;
      }

      if (name === 'SkipSelf') {
        injectionFlags |= InjectFlags.SkipSelf;
      }

      if (name === 'Host') {
        injectionFlags |= InjectFlags.Host;
      }

      if (name === 'Optional') {
        injectionFlags |= InjectFlags.Optional;
      }
    };

    let value = undefined;
    if (flags['Attribute']) {
      value = injectAttributeImpl(tNode, token);
    } else if (flags['Inject']) {
      value = injector.get(token, null, injectionFlags);
    } else {
      value = injector.get(token, null, injectionFlags);
    }

    return {token, value, flags};
  });
}

/**
 * Returns the debug (partial) metadata for a particular directive or component instance.
 * The function accepts an instance of a directive or component and returns the corresponding
 * metadata.
 *
 * @param directiveOrComponentInstance Instance of a directive or component
 * @returns metadata of the passed directive or component
 *
 * @publicApi
 * @globalApi ng
 */
export function getDirectiveMetadata(directiveOrComponentInstance: any): ComponentDebugMetadata|
    DirectiveDebugMetadata|null {
  const {constructor} = directiveOrComponentInstance;
  if (!constructor) {
    throw new Error('Unable to find the instance constructor');
  }

  // In case a component inherits from a directive, we may have component and directive metadata
  // To ensure we don't get the metadata of the directive, we want to call `getComponentDef` first.
  const componentDef = getComponentDef(constructor);
  if (componentDef) {
    return {
      inputs: componentDef.inputs,
      outputs: componentDef.outputs,
      encapsulation: componentDef.encapsulation,
      injectorParameters: ctorParametersMetadata(directiveOrComponentInstance, true),
      changeDetection: componentDef.onPush ? ChangeDetectionStrategy.OnPush :
                                             ChangeDetectionStrategy.Default
    };
  }
  const directiveDef = getDirectiveDef(constructor);
  if (directiveDef) {
    return {
      inputs: directiveDef.inputs,
      outputs: directiveDef.outputs,
      injectorParameters: ctorParametersMetadata(directiveOrComponentInstance),
    };
  }
  return null;
}

export function getElementInjectorMetadata(element: Element) {
  const context = getLContext(element);
  if (context === null) return null;

  const target = element as any as RElement;
  const nodeIndex = findViaNativeElement(context.lView!, target);
  const tView = context.lView![TVIEW];
  const tNode = tView.data[nodeIndex] as TNode;
  const injectorMetadata = tNode.__ngInjectorMetadata__;

  const elementInjectorMetadata: any[] = [];

  injectorMetadata.forEach((metadata) => {
    elementInjectorMetadata.push(metadata);
  });

  return elementInjectorMetadata;
}

/**
 * Retrieve map of local references.
 *
 * The references are retrieved as a map of local reference name to element or directive instance.
 *
 * @param target DOM element, component or directive instance for which to retrieve
 *    the local references.
 */
export function getLocalRefs(target: {}): {[key: string]: any} {
  const context = getLContext(target);
  if (context === null) return {};

  if (context.localRefs === undefined) {
    const lView = context.lView;
    if (lView === null) {
      return {};
    }
    context.localRefs = discoverLocalRefs(lView, context.nodeIndex);
  }

  return context.localRefs || {};
}

/**
 * Retrieves the host element of a component or directive instance.
 * The host element is the DOM element that matched the selector of the directive.
 *
 * @param componentOrDirective Component or directive instance for which the host
 *     element should be retrieved.
 * @returns Host element of the target.
 *
 * @publicApi
 * @globalApi ng
 */
export function getHostElement(componentOrDirective: {}): Element {
  return getLContext(componentOrDirective)!.native as unknown as Element;
}

/**
 * Retrieves the rendered text for a given component.
 *
 * This function retrieves the host element of a component and
 * and then returns the `textContent` for that element. This implies
 * that the text returned will include re-projected content of
 * the component as well.
 *
 * @param component The component to return the content text for.
 */
export function getRenderedText(component: any): string {
  const hostElement = getHostElement(component);
  return hostElement.textContent || '';
}

/**
 * Event listener configuration returned from `getListeners`.
 * @publicApi
 */
export interface Listener {
  /** Name of the event listener. */
  name: string;
  /** Element that the listener is bound to. */
  element: Element;
  /** Callback that is invoked when the event is triggered. */
  callback: (value: any) => any;
  /** Whether the listener is using event capturing. */
  useCapture: boolean;
  /**
   * Type of the listener (e.g. a native DOM event or a custom @Output).
   */
  type: 'dom'|'output';
}


/**
 * Retrieves a list of event listeners associated with a DOM element. The list does include host
 * listeners, but it does not include event listeners defined outside of the Angular context
 * (e.g. through `addEventListener`).
 *
 * @usageNotes
 * Given the following DOM structure:
 *
 * ```html
 * <app-root>
 *   <div (click)="doSomething()"></div>
 * </app-root>
 * ```
 *
 * Calling `getListeners` on `<div>` will return an object that looks as follows:
 *
 * ```ts
 * {
 *   name: 'click',
 *   element: <div>,
 *   callback: () => doSomething(),
 *   useCapture: false
 * }
 * ```
 *
 * @param element Element for which the DOM listeners should be retrieved.
 * @returns Array of event listeners on the DOM element.
 *
 * @publicApi
 * @globalApi ng
 */
export function getListeners(element: Element): Listener[] {
  ngDevMode && assertDomElement(element);
  const lContext = getLContext(element);
  const lView = lContext === null ? null : lContext.lView;
  if (lView === null) return [];

  const tView = lView[TVIEW];
  const lCleanup = lView[CLEANUP];
  const tCleanup = tView.cleanup;
  const listeners: Listener[] = [];
  if (tCleanup && lCleanup) {
    for (let i = 0; i < tCleanup.length;) {
      const firstParam = tCleanup[i++];
      const secondParam = tCleanup[i++];
      if (typeof firstParam === 'string') {
        const name: string = firstParam;
        const listenerElement = unwrapRNode(lView[secondParam]) as any as Element;
        const callback: (value: any) => any = lCleanup[tCleanup[i++]];
        const useCaptureOrIndx = tCleanup[i++];
        // if useCaptureOrIndx is boolean then report it as is.
        // if useCaptureOrIndx is positive number then it in unsubscribe method
        // if useCaptureOrIndx is negative number then it is a Subscription
        const type =
            (typeof useCaptureOrIndx === 'boolean' || useCaptureOrIndx >= 0) ? 'dom' : 'output';
        const useCapture = typeof useCaptureOrIndx === 'boolean' ? useCaptureOrIndx : false;
        if (element == listenerElement) {
          listeners.push({element, name, callback, useCapture, type});
        }
      }
    }
  }
  listeners.sort(sortListeners);
  return listeners;
}

function sortListeners(a: Listener, b: Listener) {
  if (a.name == b.name) return 0;
  return a.name < b.name ? -1 : 1;
}

/**
 * This function should not exist because it is megamorphic and only mostly correct.
 *
 * See call site for more info.
 */
function isDirectiveDefHack(obj: any): obj is DirectiveDef<any> {
  return obj.type !== undefined && obj.template !== undefined && obj.declaredInputs !== undefined;
}

/**
 * Returns the attached `DebugNode` instance for an element in the DOM.
 *
 * @param element DOM element which is owned by an existing component's view.
 */
export function getDebugNode(element: Element): DebugNode|null {
  if (ngDevMode && !(element instanceof Node)) {
    throw new Error('Expecting instance of DOM Element');
  }

  const lContext = getLContext(element)!;
  const lView = lContext ? lContext.lView : null;

  if (lView === null) {
    return null;
  }

  const nodeIndex = lContext.nodeIndex;
  if (nodeIndex !== -1) {
    const valueInLView = lView[nodeIndex];
    // this means that value in the lView is a component with its own
    // data. In this situation the TNode is not accessed at the same spot.
    const tNode =
        isLView(valueInLView) ? (valueInLView[T_HOST] as TNode) : getTNode(lView[TVIEW], nodeIndex);
    ngDevMode &&
        assertEqual(tNode.index, nodeIndex, 'Expecting that TNode at index is same as index');
    return buildDebugNode(tNode, lView);
  }

  return null;
}

/**
 * Retrieve the component `LView` from component/element.
 *
 * NOTE: `LView` is a private and should not be leaked outside.
 *       Don't export this method to `ng.*` on window.
 *
 * @param target DOM element or component instance for which to retrieve the LView.
 */
export function getComponentLView(target: any): LView {
  const lContext = getLContext(target)!;
  const nodeIndx = lContext.nodeIndex;
  const lView = lContext.lView!;
  ngDevMode && assertLView(lView);
  const componentLView = lView[nodeIndx];
  ngDevMode && assertLView(componentLView);
  return componentLView;
}

/** Asserts that a value is a DOM Element. */
function assertDomElement(value: any) {
  if (typeof Element !== 'undefined' && !(value instanceof Element)) {
    throw new Error('Expecting instance of DOM Element');
  }
}

export function getInjectorResolutionPath(element: Element): any[]|null {
  const context = getLContext(element);
  if (context === null) return null;

  const target = element as any as RElement;
  const nodeIndex = findViaNativeElement(context.lView!, target);
  const tView = context.lView![TVIEW];
  const tNode = tView.data[nodeIndex] as TNode;
  const injectorPath: any[] = [];

  const debugNodes = getInjectorPath(context.lView!, tNode);

  const debugNodeToInjector = (debugNode: any) => ({type: 'Element', owner: debugNode.constructor})

  debugNodes.forEach((node: any) => {
    injectorPath.push(debugNodeToInjector(node));
  });

  let injector = (context.lView![INJECTOR] as any).parentInjector;
  let ngModuleType =
      injector?.get?.(viewEngine_NgModuleRef, null, InjectFlags.Self)?.instance?.constructor;
  if (ngModuleType === undefined) {
    return injectorPath;
  }

  while (injector !== undefined) {
    if (injector instanceof NullInjector) {
      injectorPath.push({
        type: 'NullInjector',
        owner: injector.constructor,
      });
      break;
    } else if (injector.scopes?.has?.('platform')) {
      injectorPath.push({
        type: 'Platform',
        owner: {name: 'Platform'},
      });
    } else if (injector.scopes?.has?.('environment') && injector.scopes?.has?.('root')) {
      if (ngModuleType) {
        injectorPath.push({type: 'Module', owner: ngModuleType});
      } else {
        injectorPath.push({type: 'Injector', owner: {name: injector.source}});
      }
    } else if (ngModuleType !== undefined && ngModuleType.ɵmod) {
      injectorPath.push({
        type: 'Module',
        owner: ngModuleType,
      });
    }

    injector = injector.parent;
    const moduleRef = injector?.get?.(viewEngine_NgModuleRef, null, InjectFlags.Self);

    // skip hidden AppModule
    if (injector?.source === 'AppModule' && moduleRef === null) {
      injector = injector.parent;
    }

    ngModuleType = moduleRef?.instance?.constructor;
  }

  return injectorPath;
}

export function traceTokenInjectorPath(element: Element, tokenToTrace: any): any[]|null {
  if (tokenToTrace == null) return [];

  const context = getLContext(element);
  if (context === null) return null;

  const target = element as any as RElement;
  const nodeIndex = findViaNativeElement(context.lView!, target);
  const tView = context.lView![TVIEW];
  const tNode = tView.data[nodeIndex] as TNode;
  const injectorPath: any[] = [];

  const debugNodes = debugNodeInjectorPath(context.lView!, tNode);
  const DEVTOOLS_NOT_FOUND = {};

  const elementInjector = getInjector(element);

  let isSpecialToken = false;

  if (tokenToTrace.__NG_ELEMENT_ID__ !== undefined) {
    if (typeof tokenToTrace.__NG_ELEMENT_ID__ === 'number') {
      isSpecialToken = isSpecialToken || tokenToTrace.__NG_ELEMENT_ID__ <= -1;
    }

    if (typeof tokenToTrace.__NG_ELEMENT_ID__ === 'function') {
      isSpecialToken = true;
    }
  }

  for (const debugNode of debugNodes) {
    injectorPath.push({type: 'Element', owner: (debugNode.instances[0] as any).constructor});
    if (isSpecialToken) {
      if (elementInjector.get(
              tokenToTrace, DEVTOOLS_NOT_FOUND, InjectFlags.Self | InjectFlags.Optional) !==
          DEVTOOLS_NOT_FOUND) {
        return injectorPath;
      }
    } else {
      const injector = debugNode.injector;
      if ([...injector.providers, ...injector.viewProviders].find(
              (provider: any) => provider === tokenToTrace || provider.provide === tokenToTrace ||
                  provider.type === tokenToTrace)) {
        return injectorPath;
      }
    }
  }

  let injector = (context.lView![INJECTOR] as any).parentInjector;
  let ngModuleType =
      injector?.get?.(viewEngine_NgModuleRef, null, InjectFlags.Self)?.instance?.constructor;

  const findImportPathForTokenInModule = (moduleConstructor: any, tokenToTrace: any) => {
    let foundModule = false;
    let pathCursor: any = undefined;
    let path: any[] = [];

    const traceTokenInjectorPathVisitor = (provider: any, ngModule: any) => {
      if (foundModule) {
        const imports = getInjectorDef(ngModule)?.imports ?? [];

        if (imports.find(
                moduleImport =>
                    (moduleImport as any).ngModule === pathCursor || moduleImport === pathCursor)) {
          pathCursor = ngModule;
          path.unshift(pathCursor);
        }

        return;
      }

      const foundToken = provider === tokenToTrace || provider.provide === tokenToTrace;
      if (foundToken) {
        foundModule = true;
        pathCursor = ngModule;
        path.unshift(pathCursor);
      }
    };

    walkProviderTree(moduleConstructor, traceTokenInjectorPathVisitor, [], new Set());
    return path.map((owner: any, index: number) => {
      let type = index === 0 ? 'Module' : 'ImportedModule';
      return {type, owner};
    });
  };

  while (injector !== undefined) {
    if (injector instanceof NullInjector) {
      injectorPath.push({type: 'NullInjector', owner: injector.constructor});
      break;
    } else if (injector.scopes?.has?.('platform')) {
      injectorPath.push({type: 'Platform', owner: injector.constructor});

      if (injector.get(tokenToTrace, DEVTOOLS_NOT_FOUND, InjectFlags.Self)) {
        return injectorPath;
      }
    } else if (injector.scopes?.has?.('environment') && injector.scopes?.has?.('root')) {
      if (injector.get(tokenToTrace, DEVTOOLS_NOT_FOUND, InjectFlags.Self)) {
        const importPath = findImportPathForTokenInModule(ngModuleType, tokenToTrace);

        injectorPath.push({
          type: 'Module',
          owner: ngModuleType,
          importedFrom: importPath[importPath.length - 1],
          importPath
        });

        return injectorPath;
      }

      injectorPath.push({type: 'Module', owner: ngModuleType});
    } else if (ngModuleType !== undefined && ngModuleType.ɵmod) {
      if (injector.get(tokenToTrace, DEVTOOLS_NOT_FOUND, InjectFlags.Self) !== DEVTOOLS_NOT_FOUND) {
        const importPath = findImportPathForTokenInModule(ngModuleType, tokenToTrace);

        injectorPath.push({
          type: 'Module',
          owner: ngModuleType,
          importedFrom: importPath[importPath.length - 1],
          importPath
        });

        return injectorPath;
      }

      injectorPath.push({type: 'Module', owner: ngModuleType});
    }

    injector = injector.parent;
    const moduleRef = injector?.get?.(viewEngine_NgModuleRef, null, InjectFlags.Self);

    // skip hidden AppModule
    if (injector?.source === 'AppModule' && moduleRef === null) {
      injector = injector.parent;
    }

    ngModuleType = moduleRef.instance.constructor;
  }

  return injectorPath;
}

function getInjectorPath(lView: LView, tNode: TNode): DebugNode[] {
  const path: DebugNode[] = [];
  let injectorIndex = getInjectorIndex(tNode, lView);
  if (injectorIndex === -1) {
    // Looks like the current `TNode` does not have `NodeInjecetor` associated with it => look for
    // parent NodeInjector.
    const parentLocation = getParentInjectorLocation(tNode, lView);
    if (parentLocation !== NO_PARENT_INJECTOR) {
      // We found a parent, so start searching from the parent location.
      injectorIndex = getParentInjectorIndex(parentLocation);
      lView = getParentInjectorView(parentLocation, lView);
    } else {
      // No parents have been found, so there are no `NodeInjector`s to consult.
    }
  }
  while (injectorIndex !== -1) {
    ngDevMode && assertNodeInjector(lView, injectorIndex);
    const tNode = lView[TVIEW].data[injectorIndex + NodeInjectorOffset.TNODE] as TNode;

    path.push(lView[tNode.directiveStart]);

    const parentLocation = lView[injectorIndex + NodeInjectorOffset.PARENT];
    if (parentLocation === NO_PARENT_INJECTOR) {
      injectorIndex = -1;
    } else {
      injectorIndex = getParentInjectorIndex(parentLocation);
      lView = getParentInjectorView(parentLocation, lView);
    }
  }
  return path;
}

function debugNodeInjectorPath(lView: LView, tNode: TNode): DebugNode[] {
  const path: DebugNode[] = [];
  let injectorIndex = getInjectorIndex(tNode, lView);
  if (injectorIndex === -1) {
    // Looks like the current `TNode` does not have `NodeInjecetor` associated with it => look for
    // parent NodeInjector.
    const parentLocation = getParentInjectorLocation(tNode, lView);
    if (parentLocation !== NO_PARENT_INJECTOR) {
      // We found a parent, so start searching from the parent location.
      injectorIndex = getParentInjectorIndex(parentLocation);
      lView = getParentInjectorView(parentLocation, lView);
    } else {
      // No parents have been found, so there are no `NodeInjector`s to consult.
    }
  }
  while (injectorIndex !== -1) {
    ngDevMode && assertNodeInjector(lView, injectorIndex);
    const tNode = lView[TVIEW].data[injectorIndex + NodeInjectorOffset.TNODE] as TNode;
    path.push(buildDebugNode(tNode, lView));
    const parentLocation = lView[injectorIndex + NodeInjectorOffset.PARENT];
    if (parentLocation === NO_PARENT_INJECTOR) {
      injectorIndex = -1;
    } else {
      injectorIndex = getParentInjectorIndex(parentLocation);
      lView = getParentInjectorView(parentLocation, lView);
    }
  }
  return path;
}