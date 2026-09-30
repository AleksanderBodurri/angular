/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {NotificationSource} from '../../../change_detection/scheduling/zoneless_scheduling';

/** Angular's name for a notification source. */
export function getNotificationSourceName(source: NotificationSource): string {
  switch (source) {
    case NotificationSource.MarkAncestorsForTraversal:
      return 'markAncestorsForTraversal';
    case NotificationSource.SetInput:
      return 'setInput';
    case NotificationSource.DeferBlockStateUpdate:
      return 'deferBlockStateUpdate';
    case NotificationSource.DebugApplyChanges:
      return 'debugApplyChanges';
    case NotificationSource.MarkForCheck:
      return 'markForCheck';
    case NotificationSource.Listener:
      return 'listener';
    case NotificationSource.CustomElement:
      return 'customElement';
    case NotificationSource.RenderHook:
      return 'renderHook';
    case NotificationSource.ViewAttached:
      return 'viewAttached';
    case NotificationSource.ViewDetachedFromDOM:
      return 'viewDetachedFromDOM';
    case NotificationSource.AsyncAnimationsLoaded:
      return 'asyncAnimationsLoaded';
    case NotificationSource.PendingTaskRemoved:
      return 'pendingTaskRemoved';
    case NotificationSource.RootEffect:
      return 'rootEffect';
    case NotificationSource.ViewEffect:
      return 'viewEffect';
    default: {
      // Does not compile once `NotificationSource` has a member without a name above.
      const unnamed: never = source;
      return `unknown (${unnamed})`;
    }
  }
}
