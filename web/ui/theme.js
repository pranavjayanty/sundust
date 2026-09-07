/* Light and dark are both real themes from one token set. The choice is
   applied before first paint by an inline script in the document head, so
   there is no flash; this module only handles changing it afterwards. */

import { $, clear, icon } from '../lib/dom.js';

const KEY = 'sundust-theme';
const watchers = new Set();

export const currentTheme = () => document.documentElement.dataset.theme
  || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');

export function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(KEY, t); } catch {}
  paintIcon();
  for (const fn of watchers) fn(t);
}

export const toggleTheme = () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
export const onThemeChange = (fn) => { watchers.add(fn); return () => watchers.delete(fn); };

function paintIcon() {
  const btn = $('#btn-theme');
  if (!btn) return;
  const dark = currentTheme() === 'dark';
  clear(btn).append(icon(dark ? 'sun' : 'moon'));
  btn.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} theme`);
  btn.title = `Switch to ${dark ? 'light' : 'dark'} theme (t)`;
}

export function initTheme() {
  paintIcon();
  // a viewer who never chose a theme should follow the system when it changes
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (!document.documentElement.dataset.theme) { paintIcon(); for (const fn of watchers) fn(currentTheme()); }
  });
}
