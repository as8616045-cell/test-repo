// js/batch.js — concurrent task queue with progress.
// Used by all pages that need to process N items.

import { loadSettings } from './settings.js';

/**
 * Run an array of jobs with limited concurrency.
 * @template T, R
 * @param {T[]} items
 * @param {(item: T, idx: number, signal: AbortSignal) => Promise<R>} worker
 * @param {object} opts
 * @param {number} [opts.concurrency]
 * @param {(state: BatchState<T,R>) => void} [opts.onUpdate]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<BatchResult<T,R>[]>}
 */
export async function runBatch(items, worker, { concurrency, onUpdate, signal } = {}) {
  const limit = concurrency || loadSettings().concurrency || 3;
  /** @type {BatchResult<T,R>[]} */
  const results = items.map((item, i) => ({
    index: i, item, status: 'pending', result: null, error: null,
  }));

  let cursor = 0;
  const update = () => onUpdate?.({ results, total: items.length });

  async function nextJob() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i].status = 'running';
      update();
      try {
        if (signal?.aborted) throw new Error('用户取消');
        const r = await worker(items[i], i, signal);
        results[i].status = 'done';
        results[i].result = r;
      } catch (e) {
        results[i].status = 'error';
        results[i].error = e.message || String(e);
      }
      update();
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => nextJob());
  await Promise.all(workers);
  return results;
}

/**
 * @typedef BatchResult
 * @property {number} index
 * @property {*} item
 * @property {'pending'|'running'|'done'|'error'} status
 * @property {*} result
 * @property {string|null} error
 */
