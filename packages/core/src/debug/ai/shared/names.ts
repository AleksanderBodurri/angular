/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {DirectiveDef} from '../../../render3/interfaces/definition';
import {isComponentDef} from '../../../render3/interfaces/type_checks';

/**
 * Returns the class name of a component or directive.
 *
 * Prefers the name the compiler records in dev mode, since bundlers can rename classes: esbuild
 * (used by the Angular CLI) emits `var Foo = class _Foo {}`, making `Foo.name` equal `_Foo`.
 * Without debug info (directives, library code, JIT), strips that one leading underscore, as
 * Angular DevTools does.
 */
export function getClassName(def: DirectiveDef<unknown>): string {
  const debugName = isComponentDef(def) ? def.debugInfo?.className : undefined;
  if (debugName) return debugName;

  return stripLeadingUnderscore(def.type.name);
}

/** Strips the one leading underscore bundlers add to self-referencing classes. */
export function stripLeadingUnderscore(name: string): string {
  return name.startsWith('_') ? name.slice(1) : name;
}
