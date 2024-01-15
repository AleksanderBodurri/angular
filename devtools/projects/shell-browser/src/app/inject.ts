/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

const loadScripts = (urls: string[]) => {
  return urls
      .map((url, idx) => {
        return `
      const script${idx} = document.constructor.prototype.createElement.call(document, 'script');
      script${idx}.src = getScriptName("${url}");
      document.documentElement.appendChild(script${idx});
      script${idx}.parentNode.removeChild(script${idx});
    `;
      })
      .join('\n');
};
