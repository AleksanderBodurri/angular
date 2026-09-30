/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

/** The number of stack frames captured, before the frames of Angular are left out. */
const CAPTURED_FRAMES = 40;

/** One frame of a stack, as the browser reports it. */
export interface RawStackFrame {
  /** The name of the function, such as `CartStore.add`, or `null` for an anonymous one. */
  fn: string | null;
  url: string;
  line: number;
  column: number;
}

/**
 * Captures the current stack, `frames` deep. Formatting it is left for later, which is when it
 * costs most; capturing costs about a microsecond per frame.
 */
export function captureStack(frames: number = CAPTURED_FRAMES): Error {
  const errorConstructor = Error as {stackTraceLimit?: number};
  const limit = errorConstructor.stackTraceLimit;
  errorConstructor.stackTraceLimit = frames;
  try {
    return new Error();
  } finally {
    errorConstructor.stackTraceLimit = limit;
  }
}

/** A frame as Chrome reports it: `    at Class.method (url:line:column)`. */
const V8_FRAME = /^\s*at (?:async )?(?:new )?(?:(.*?) \()?(\S+?):(\d+):(\d+)\)?\s*$/;

/** A frame as Firefox and Safari report it: `method@url:line:column`. */
const AT_SIGN_FRAME = /^(.*?)@(\S+):(\d+):(\d+)$/;

/** Names Safari gives to code outside of any function. */
const TOP_LEVEL_CODE = /^(module|global|eval) code$/;

/**
 * Reads the frames of a captured stack, leaving out the ones without a location. Firefox ignores
 * `Error.stackTraceLimit`, so at most as many frames as the other browsers capture are read.
 */
export function parseStack(error: Error): RawStackFrame[] {
  return parseFrames(error).frames;
}

/**
 * Reads the frames of a captured stack, as {@link parseStack} does, and names the class of each
 * method where the browser leaves it out. Firefox and Safari report `add` where Chrome reports
 * `PendingTasks.add`; the class is then read from the script the frame is in.
 */
export async function readStack(error: Error): Promise<RawStackFrame[]> {
  const {frames, withClasses} = parseFrames(error);
  if (withClasses) return frames;
  return Promise.all(
    frames.map(async (frame) =>
      hasObjectName(frame) ? frame : withClassName(frame, await classAround(frame)),
    ),
  );
}

function parseFrames(error: Error): {frames: RawStackFrame[]; withClasses: boolean} {
  const lines = (error.stack ?? '').split('\n');
  const v8 = lines.some((line) => V8_FRAME.test(line));
  const frames: RawStackFrame[] = [];
  for (const line of lines) {
    if (frames.length >= CAPTURED_FRAMES) break;
    const match = v8 ? V8_FRAME.exec(line) : AT_SIGN_FRAME.exec(line.trim());
    if (match === null) continue;
    frames.push({
      fn: v8 ? match[1] || null : functionName(match[1]),
      url: match[2],
      line: Number(match[3]),
      column: Number(match[4]),
    });
  }
  return {frames, withClasses: v8};
}

/**
 * The name of a function as Firefox and Safari report it, in the form Chrome uses where they
 * differ: Firefox prefixes the frames of an async call with what scheduled them, as in
 * `setTimeout handler*poll`, and names methods of a prototype `Class.prototype.method`.
 */
function functionName(reported: string): string | null {
  const name = reported.replace(/^.*\*/, '').replace(/\.prototype\./g, '.');
  return name === '' || TOP_LEVEL_CODE.test(name) ? null : name;
}

/**
 * The function a name starts with. Firefox names a function inside `notify` as `notify/<`, and a
 * class field initializer of `Page` as `Page<`.
 */
function outerName(fn: string): string {
  return fn.split(/[/<]/)[0];
}

/** Whether a frame names the object of its method, as in `Class.method`. */
function hasObjectName({fn}: RawStackFrame): boolean {
  return fn !== null && outerName(fn).includes('.');
}

/** Names the class of a frame as `Class.method`, unless it is `null` or the frame names it. */
export function withClassName(frame: RawStackFrame, className: string | null): RawStackFrame {
  const {fn} = frame;
  if (className === null || hasObjectName(frame)) return frame;
  if (fn === null) return {...frame, fn: `${className}.<anonymous>`};
  if (outerName(fn) === className) return frame;
  return {...frame, fn: `${className}.${fn}`};
}

/** The classes around lines of scripts, by `url:line`. */
const classesAround = new Map<string, string | null>();

async function classAround({url, line}: RawStackFrame): Promise<string | null> {
  const key = `${url}:${line}`;
  let className = classesAround.get(key);
  if (className === undefined) {
    const script = await loadScriptLines(url);
    className = script === null ? null : findEnclosingClass(script, line);
    classesAround.set(key, className);
  }
  return className;
}

/**
 * A line that declares a class, as `class A {`, `var A = class A {` or `var A = class {`. Bundlers
 * leave out the name of a class expression that nothing reads, which then takes its variable's.
 */
const CLASS_DECLARATION =
  /(?:([\w$]+)\s*=\s*)?\bclass(?:\s+(?!extends\b)([\w$]+))?\s*(?:extends\b|\{)/;

/**
 * Finds the class around a 1-based `line` of a script from its indentation: the closest line
 * above it that is indented less than every line between them, and declares a class. Dev servers
 * serve Angular and the application unminified, indented by block.
 */
export function findEnclosingClass(script: string[], line: number): string | null {
  let indent = indentation(script[line - 1] ?? '');
  for (let i = line - 2; i >= 0 && indent > 0; i--) {
    const text = script[i];
    if (text.trim() === '' || indentation(text) >= indent) continue;
    indent = indentation(text);
    const match = CLASS_DECLARATION.exec(text);
    if (match !== null) return match[2] ?? match[1] ?? null;
  }
  return null;
}

function indentation(text: string): number {
  return text.length - text.trimStart().length;
}

/** The lines of scripts by URL, loaded at most once each, to name the classes of their frames. */
const scriptLines = new Map<string, Promise<string[] | null>>();

function loadScriptLines(url: string): Promise<string[] | null> {
  let lines = scriptLines.get(url);
  if (lines === undefined) {
    lines = fetchSameOriginScript(url)
      .then((script) => script?.split('\n') ?? null)
      .catch(() => null);
    scriptLines.set(url, lines);
  }
  return lines;
}

/** Fetches a script of the page's origin, or returns `null` for other scripts. */
async function fetchSameOriginScript(url: string): Promise<string | null> {
  // Scripts of other origins cannot be read without CORS headers, and trying logs an error.
  if (!/^https?:/.test(url) || new URL(url).origin !== location.origin) return null;
  return (await fetch(url)).text();
}

/** A position in an original source file. */
export interface SourcePosition {
  source: string;
  line: number;
  column: number;
}

/** A decoded source map. */
export interface DecodedSourceMap {
  sources: string[];

  /**
   * Segments of each generated line, sorted by column: `[column]`, or
   * `[column, source, line, column]` with 0-based numbers.
   */
  lines: number[][][];
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decodes the `mappings` of a source map (version 3). */
export function decodeMappings(mappings: string): number[][][] {
  const lines: number[][][] = [];
  let line: number[][] = [];
  let generatedColumn = 0;
  let source = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let fields: number[] = [];
  let value = 0;
  let shift = 0;

  const endSegment = () => {
    if (fields.length === 0) return;
    generatedColumn += fields[0];
    if (fields.length >= 4) {
      source += fields[1];
      originalLine += fields[2];
      originalColumn += fields[3];
      line.push([generatedColumn, source, originalLine, originalColumn]);
    } else {
      line.push([generatedColumn]);
    }
    fields = [];
  };

  for (let i = 0; i < mappings.length; i++) {
    const char = mappings[i];
    if (char === ';') {
      endSegment();
      lines.push(line);
      line = [];
      generatedColumn = 0;
    } else if (char === ',') {
      endSegment();
    } else {
      const digit = BASE64.indexOf(char);
      if (digit < 0) continue;
      value += (digit & 31) << shift;
      if (digit & 32) {
        shift += 5;
      } else {
        fields.push(value & 1 ? -(value >>> 1) : value >>> 1);
        value = 0;
        shift = 0;
      }
    }
  }
  endSegment();
  lines.push(line);
  return lines;
}

/** Finds the original position of a 1-based `line` and `column` of the generated file. */
export function lookupPosition(
  map: DecodedSourceMap,
  line: number,
  column: number,
): SourcePosition | null {
  const segments = map.lines[line - 1];
  if (segments === undefined) return null;
  let found: number[] | null = null;
  for (const segment of segments) {
    if (segment[0] > column - 1) break;
    if (segment.length >= 4) found = segment;
  }
  if (found === null) return null;
  return {source: map.sources[found[1]], line: found[2] + 1, column: found[3] + 1};
}

/** Source maps by the URL of the script they map, loaded at most once each. */
const sourceMaps = new Map<string, Promise<DecodedSourceMap | null>>();

/** Loads the source map of the script at `url`, or `null` if it has none or cannot be read. */
function loadSourceMap(url: string): Promise<DecodedSourceMap | null> {
  let map = sourceMaps.get(url);
  if (map === undefined) {
    map = fetchSourceMap(url).catch(() => null);
    sourceMaps.set(url, map);
  }
  return map;
}

/**
 * Finds the reference to the source map in the text of a script: a URL, or a `data:` URL holding
 * the map itself, which can be far longer than the rest of the script.
 */
export function findSourceMappingUrl(script: string): string | null {
  const marker = 'sourceMappingURL=';
  const index = script.lastIndexOf(marker);
  if (index < 4 || !/^\/\/[#@] $/.test(script.slice(index - 4, index))) return null;
  const end = script.indexOf('\n', index);
  const reference = script.slice(index + marker.length, end < 0 ? undefined : end).trim();
  return reference === '' ? null : reference;
}

async function fetchSourceMap(url: string): Promise<DecodedSourceMap | null> {
  const script = await fetchSameOriginScript(url);
  if (script === null) return null;
  const reference = findSourceMappingUrl(script);
  if (reference === null) return null;
  const mapUrl = new URL(reference, url).href;
  const raw = mapUrl.startsWith('data:')
    ? decodeDataUrl(mapUrl)
    : await (await fetch(mapUrl)).json();
  return readSourceMap(raw, mapUrl, url);
}

/** Reads the JSON in a `data:` URL without fetching it, so that it does not show as a request. */
function decodeDataUrl(url: string): unknown {
  const comma = url.indexOf(',');
  const header = url.slice(0, comma);
  const body = url.slice(comma + 1);
  if (!header.endsWith(';base64')) return JSON.parse(decodeURIComponent(body));
  const bytes = Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * Reads a source map fetched from `mapUrl` for the script at `scriptUrl`. The sources of a map
 * inlined as a `data:` URL are relative to the script, as a `data:` URL cannot be a base.
 */
export function readSourceMap(
  raw: unknown,
  mapUrl: string,
  scriptUrl: string,
): DecodedSourceMap | null {
  const {sources, sourceRoot, mappings} = (raw ?? {}) as {
    sources?: unknown;
    sourceRoot?: unknown;
    mappings?: unknown;
  };
  if (!Array.isArray(sources) || typeof mappings !== 'string') return null;
  const base = mapUrl.startsWith('data:') ? scriptUrl : mapUrl;
  const root = typeof sourceRoot === 'string' && sourceRoot ? new URL(sourceRoot, base).href : base;
  return {
    sources: sources.map((source) => displaySource(new URL(String(source), root).href)),
    lines: decodeMappings(mappings),
  };
}

/**
 * The path to show for a source: from `node_modules/` for packages, otherwise the path on the dev
 * server, such as `src/app/board/board.page.ts`.
 */
function displaySource(url: string): string {
  const packages = url.lastIndexOf('/node_modules/');
  if (packages >= 0) return url.slice(packages + 1);
  try {
    const {protocol, pathname} = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? pathname.replace(/^\/+/, '') : url;
  } catch {
    return url;
  }
}

/** Packages whose frames say nothing about the application: Angular itself and its plumbing. */
const FRAMEWORK_SOURCE = /(^|\/)node_modules\/(@angular|rxjs|tslib|zone\.js)\//;

/** Files the dev server bundles Angular and its plumbing into, judged by their URL. */
const FRAMEWORK_BUNDLE = /\/(@angular_[^/]*|rxjs[^/]*|zone\.js[^/]*|tslib[^/]*)\.js(\?|$)/;

/** A frame of the application or of a third-party script, as shown to an agent. */
export interface ShownStackFrame {
  /** `file:line:column`, mapped to the original source when the script has a source map. */
  location: string;
  fn: string | null;
}

/**
 * Maps the frames of a stack to their original sources and leaves out the frames of Angular and
 * its plumbing, keeping at most `limit` frames.
 */
export async function resolveStack(
  frames: RawStackFrame[],
  limit: number,
): Promise<ShownStackFrame[]> {
  const shown: ShownStackFrame[] = [];
  for (const frame of frames) {
    if (shown.length >= limit) break;
    if (FRAMEWORK_BUNDLE.test(frame.url)) continue;
    const map = /^https?:/.test(frame.url) ? await loadSourceMap(frame.url) : null;
    const position = map === null ? null : lookupPosition(map, frame.line, frame.column);
    if (position !== null && FRAMEWORK_SOURCE.test(position.source)) continue;
    shown.push({
      location:
        position === null
          ? `${frame.url}:${frame.line}:${frame.column}`
          : `${position.source}:${position.line}:${position.column}`,
      fn: frame.fn,
    });
  }
  return shown;
}
