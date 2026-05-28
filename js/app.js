// js/app.js — entry: tab routing + page lifecycle

import { toast } from './utils.js';

const PAGES = {
  reverse:         () => import('./pages/reverse.js'),
  consistent:      () => import('./pages/consistent.js'),
  'change-product':() => import('./pages/change-product.js'),
  'change-bg':     () => import('./pages/change-bg.js'),
  batch:           () => import('./pages/batch-page.js'),
  history:         () => import('./pages/history.js'),
  settings:        () => import('./pages/settings-page.js'),
};

const DEFAULT_TAB = 'reverse';
let currentDestroy = null;

async function loadTab(name) {
  if (!PAGES[name]) name = DEFAULT_TAB;
  const host = document.getElementById('page-host');
  // teardown previous
  try { currentDestroy?.(); } catch {}
  currentDestroy = null;
  host.innerHTML = '<div class="text-slate-400 text-sm">加载中…</div>';

  // highlight nav
  document.querySelectorAll('#nav .nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === name);
  });

  try {
    const mod = await PAGES[name]();
    host.innerHTML = '';
    currentDestroy = await mod.render(host);
    location.hash = '#' + name;
  } catch (e) {
    console.error(e);
    host.innerHTML = `<div class="card text-red-600">页面加载失败：${e.message}</div>`;
    toast('页面加载失败：' + e.message, 'error');
  }
}

function init() {
  document.getElementById('nav').addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]');
    if (b) loadTab(b.dataset.tab);
  });

  const initial = (location.hash || '').replace('#', '') || DEFAULT_TAB;
  loadTab(initial);

  window.addEventListener('hashchange', () => {
    loadTab((location.hash || '').replace('#', '') || DEFAULT_TAB);
  });
}

init();
