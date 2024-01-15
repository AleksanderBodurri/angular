/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {ChangeDetectorRef, Component, inject, NgZone, OnInit} from '@angular/core';
import {ApplicationEnvironment} from 'ng-devtools';
import {Events, MessageBus, PriorityAwareMessageBus} from 'protocol';

import {ZoneAwareChromeMessageBus} from './zone-aware-chrome-message-bus';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  providers: [
    {
      provide: MessageBus,
      useFactory(ngZone: NgZone): MessageBus<Events> {
        const port = chrome.runtime.connect({
          name: '' + chrome.devtools.inspectedWindow.tabId,
        });

        return new PriorityAwareMessageBus(new ZoneAwareChromeMessageBus(port, ngZone));
      },
      deps: [NgZone],
    },
  ],
})
export class AppComponent implements OnInit {
  environment = inject(ApplicationEnvironment);
  private _cd = inject(ChangeDetectorRef);

  ngOnInit(): void {
    this.environment.inspectedWindowTabId = chrome.devtools.inspectedWindow.tabId;

    chrome.devtools.network.onNavigated.addListener(() => {
      window.location.reload();
    });

    this._cd.detectChanges();
  }
}
