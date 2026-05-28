// js/utils.js — small helpers shared across pages

/** File -> base64 dataURL */
export function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/** Strip data:*;base64, prefix → raw base64 */
export function stripDataURL(dataURL) {
  const idx = dataURL.indexOf('base64,');
  return idx >= 0 ? dataURL.slice(idx + 7) : dataURL;
}

/** Fetch a remote URL and convert to dataURL (used to display API outputs) */
export async function urlToDataURL(url) {
  const r = await fetch(url);
  const blob = await r.blob();
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

/** Trigger browser download */
export function download(filename, dataURL) {
  const a = document.createElement('a');
  a.href = dataURL;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Toast notification */
export function toast(msg, kind = 'info', timeout = 3000) {
  const host = document.getElementById('toast-host');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .25s';
    setTimeout(() => el.remove(), 250);
  }, timeout);
}

/** Tiny HTML escape */
export function esc(s = '') {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

/** Sleep ms */
export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Generate short id */
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Copy text to clipboard with toast */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制到剪贴板', 'success');
  } catch {
    toast('复制失败，请手动复制', 'error');
  }
}

/** Read JSON file via input */
export function readJSONFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      try { resolve(JSON.parse(r.result)); } catch (e) { reject(e); }
    };
    r.onerror = reject;
    r.readAsText(file);
  });
}

/** Parse a CSV file (very simple, supports quoted fields with comma) */
export function parseCSV(text) {
  const rows = [];
  let cur = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (q) {
      if (c === '"' && n === '"') { field += '"'; i++; }
      else if (c === '"') { q = false; }
      else field += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') { cur.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (field || cur.length) { cur.push(field); rows.push(cur); cur = []; field = ''; }
        if (c === '\r' && n === '\n') i++;
      } else field += c;
    }
  }
  if (field || cur.length) { cur.push(field); rows.push(cur); }
  if (!rows.length) return [];
  const header = rows[0];
  return rows.slice(1).map(r => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] || '').trim()])));
}

/** Build a name like 2026-05-28T15-22-01_abc123.png */
export function timestampedName(prefix = 'gen', ext = 'png') {
  const t = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${prefix}_${t}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
}
