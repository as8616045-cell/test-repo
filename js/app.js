// js/app.js — entry: tab routing + page lifecycle

import { toast } from './utils.js';

const PAGES = {
  workflow: () => import('./pages/workflow.js'),
  history:  () => import('./pages/history.js'),
  settings: () => import('./pages/settings-page.js'),
};

const DEFAULT_TAB = 'workflow';
let currentDestroy = null;

async function loadTab(name) {
  if (!PAGES[name]) name = DEFAULT_TAB;
  const host = document.getElementById('page-host');
  try { currentDestroy?.(); } catch {}
  currentDestroy = null;
  host.innerHTML = '<div class="text-slate-400 text-sm">加载中…</div>';

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
