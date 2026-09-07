/* The three DOM helpers the whole console is built from. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** el('div', 'cls', 'text') — the only element factory in the app. */
export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** el() with attributes, for the cases that need aria or type. */
export function elx(tag, cls, text, attrs) {
  const n = el(tag, cls, text);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    n.setAttribute(k, v === true ? '' : String(v));
  }
  return n;
}

/** An inline icon from the sprite in index.html. */
export function icon(name, cls = 'ic') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

export const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); return node; };

/** True on Apple hardware, so we can print the right modifier key. */
export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modKey = isMac ? '⌘' : 'Ctrl ';
