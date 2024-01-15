/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

/// <reference types="chrome"/>

import {AngularDetection, Events, Topic} from 'protocol';

const isManifestV3 = chrome.runtime.getManifest().manifest_version === 3;

const browserAction = (() => {
  // Electron does not expose browserAction object,
  // Use empty calls as fallback if they are not defined.
  const noopAction = {setIcon: () => {}, setPopup: () => {}};

  if (isManifestV3) {
    return chrome.action || noopAction;
  }

  return chrome.browserAction || noopAction;
})();

// By default use the black and white icon.
// Replace it only when we detect an Angular app.
browserAction.setIcon(
    {
      path: {
        16: chrome.runtime.getURL(`assets/icon-bw16.png`),
        48: chrome.runtime.getURL(`assets/icon-bw48.png`),
        128: chrome.runtime.getURL(`assets/icon-bw128.png`),
      },
    },
    () => {});

interface ContentScriptConnection {
  port: chrome.runtime.Port|null;
  enabled: boolean;
  frameId: string;
  pipeSetup: boolean;
  backendReady?: boolean;
}

interface DevToolsConnection {
  'content-script': chrome.runtime.Port|null;
  devtools: chrome.runtime.Port|null;
  contentScripts: {[name: string]: ContentScriptConnection};
}

const ports: {[tab: string]: DevToolsConnection|undefined} = {};

function isNumeric(str: string): boolean {
  return +str + '' === str;
};

function installContentScript(tabId: number) {
  // tslint:disable-next-line:no-console
  console.log('Installing the content-script');

  // We first inject the content-script and after that
  // invoke the global that it exposes.

  if (isManifestV3) {
    chrome.scripting.executeScript(
        {files: ['app/content_script_bundle.js'], target: {tabId, allFrames: true}}, () => {
          chrome.scripting.executeScript(
              {func: () => (globalThis as any).main(), target: {tabId, allFrames: true}});
        });

    return;
  }

  // manifest V2 APIs
  chrome.tabs.executeScript(
      tabId, {file: 'app/content_script_bundle.js', allFrames: true}, (result) => {
        chrome.tabs.executeScript(tabId, {code: 'globalThis.main()', allFrames: true});
      });
};

function doublePipe(
    devtoolsPort: chrome.runtime.Port|null,
    contentScriptConnection: ContentScriptConnection,
) {
  if (contentScriptConnection.pipeSetup === true) {
    return;
  }

  if (devtoolsPort === null) {
    throw 'DevTools port is equal to null';
  }

  const contentScriptPort = contentScriptConnection.port;

  if (contentScriptPort === null) {
    throw 'Content script port is equal to null';
  }

  // tslint:disable-next-line:no-console
  console.log('Creating two-way communication channel', Date.now(), ports);

  const onDevToolsMessage = (message: {topic: Topic, args: any[]}) => {
    if (message.topic === 'enableFrameConnection' && message.args[0] !== undefined &&
        message.args[0] === contentScriptConnection.frameId) {
      const tabId = message.args[1];
      const tab = ports[tabId];
      if (tab?.contentScripts === undefined) {
        return;
      }

      Object.keys(tab.contentScripts).forEach((key) => {
        tab.contentScripts[key].enabled = false;
      });

      contentScriptConnection.enabled = true;
    }

    if (!contentScriptConnection.enabled) {
      return;
    }

    contentScriptPort.postMessage(message);
  };
  devtoolsPort.onMessage.addListener(onDevToolsMessage);

  const onContentScriptMessage = (message: {topic: Topic}) => {
    if (message.topic === 'backendReady') {
      devtoolsPort.postMessage({
        topic: 'contentScriptRegistered',
        args: [contentScriptConnection.frameId, contentScriptConnection.port!.name]
      });
    }

    if (!contentScriptConnection.enabled) {
      return;
    }

    devtoolsPort.postMessage(message);
  };
  contentScriptPort.onMessage.addListener(onContentScriptMessage);

  const shutdownContentScript = () => {
    devtoolsPort.onMessage.removeListener(onDevToolsMessage);
    devtoolsPort.postMessage({
      topic: 'contentScriptDisconnected',
      args: [contentScriptConnection.frameId, contentScriptConnection.port!.name]
    });

    contentScriptPort.onMessage.removeListener(onContentScriptMessage);
    contentScriptPort.disconnect();
  } contentScriptPort.onDisconnect.addListener(() => shutdownContentScript());

  contentScriptConnection.pipeSetup = true;
};

function getPopUpName(ng: AngularDetection) {
  if (!ng.isAngular) {
    return 'not-angular.html';
  }
  if (!ng.isIvy || !ng.isSupportedAngularVersion) {
    return 'unsupported.html';
  }
  if (!ng.isDebugMode) {
    return 'production.html';
  }
  return 'supported.html';
};

chrome.runtime.onConnect.addListener((port) => {
  if (isNumeric(port.name)) {
    installContentScript(parseInt(port.name, 10));
    registerPortTab(port, 'devtools', port.name);
    return;
  }

  if (!port.sender || !port.sender.tab || port.sender.tab.id === undefined ||
      port.sender.frameId === undefined) {
    return;
  }

  const frameId = port.sender.frameId.toString();
  registerPortTab(port, frameId, port.sender.tab.id.toString());
});

function registerPortTab(port: chrome.runtime.Port, frameId: string, tabId: string) {
  ports[tabId] = ports[tabId] ?? {
    devtools: null,
    'content-script': null,
    contentScripts: {[frameId]: {port: null, enabled: false, frameId: '-1', pipeSetup: false}}
  };

  const tab = ports[tabId]!;

  if (frameId === 'devtools') {
    tab.devtools = port;
    tab.devtools.onDisconnect.addListener(() => {
      if (!tab.devtools) {
        return;
      }

      Object.entries(tab.contentScripts).forEach(([frameId, connection]) => {
        connection.pipeSetup = false;
      });

      tab.devtools.disconnect();
      tab.devtools = null;
    });
  } else {
    tab.contentScripts[frameId] = tab.contentScripts[frameId] ?? {port: null, enabled: false};
    tab.contentScripts[frameId].port = port;
    tab.contentScripts[frameId].frameId = frameId;
    tab.contentScripts[frameId].enabled = tab.contentScripts[frameId].enabled ?? false;
    port.onDisconnect.addListener(() => {
      const port = tab.contentScripts[frameId].port;
      if (!port) {
        return;
      }
      port.disconnect();
      delete tab.contentScripts[frameId];

      if (Object.keys(tab.contentScripts).length === 0) {
        delete ports[tabId];
      }
    });
  }

  if (tab.devtools) {
    Object.entries(tab.contentScripts).forEach(([frameId, connection]) => {
      if (tab.devtools === null || connection.port === null) {
        return;
      }

      if (connection.backendReady !== true) {
        return;
      }

      tab.devtools!.postMessage(
          {topic: 'contentScriptRegistered', args: [frameId, connection.port.name]});
      doublePipe(tab.devtools, connection);
    });
  }

  if (tab.contentScripts[frameId] && frameId !== 'devtools') {
    tab.contentScripts[frameId].port!.onMessage.addListener((message) => {
      if (message.topic === 'backendReady') {
        tab.contentScripts[frameId].backendReady = true;
      }
    });
  }

  if (tab.devtools && tab.contentScripts[frameId]) {
    console.log(`Connecting ports for tab ${tabId}`);
    console.log('Ports: ', tab.devtools, tab.contentScripts[frameId]);
    console.log(`Name: ${frameId}`);

    doublePipe(tab.devtools, tab.contentScripts[frameId]);
  }
}

chrome.runtime.onMessage.addListener((req: AngularDetection, sender) => {
  if (!req.isAngularDevTools) {
    return;
  }

  if (sender && sender.tab) {
    browserAction.setPopup({
      tabId: sender.tab.id,
      popup: `popups/${getPopUpName(req)}`,
    });
  }

  if (sender && sender.tab && req.isAngular) {
    browserAction.setIcon(
        {
          tabId: sender.tab.id,
          path: {
            16: chrome.runtime.getURL(`assets/icon16.png`),
            48: chrome.runtime.getURL(`assets/icon48.png`),
            128: chrome.runtime.getURL(`assets/icon128.png`),
          },
        },
        () => {});
  }
});
