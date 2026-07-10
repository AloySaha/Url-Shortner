(function () {
  'use strict';

  const HISTORY_KEY = 'linkly.history.v1';
  const MAX_HISTORY = 30;

  const els = {
    form: document.getElementById('shortenForm'),
    urlInput: document.getElementById('urlInput'),
    aliasInput: document.getElementById('aliasInput'),
    titleInput: document.getElementById('titleInput'),
    expiresInput: document.getElementById('expiresInput'),
    formError: document.getElementById('formError'),
    shortenBtn: document.getElementById('shortenBtn'),
    resultCard: document.getElementById('resultCard'),
    resultTitle: document.getElementById('resultTitle'),
    resultUrl: document.getElementById('resultUrl'),
    resultOriginal: document.getElementById('resultOriginal'),
    copyBtn: document.getElementById('copyBtn'),
    qrBtn: document.getElementById('qrBtn'),
    statsBtn: document.getElementById('statsBtn'),
    openBtn: document.getElementById('openBtn'),
    qrPanel: document.getElementById('qrPanel'),
    qrCanvas: document.getElementById('qrCanvas'),
    downloadQrBtn: document.getElementById('downloadQrBtn'),
    historyBody: document.getElementById('historyBody'),
    refreshHistoryBtn: document.getElementById('refreshHistoryBtn'),
    clearHistoryBtn: document.getElementById('clearHistoryBtn'),
    lookupForm: document.getElementById('lookupForm'),
    lookupInput: document.getElementById('lookupInput'),
    statsCard: document.getElementById('statsCard'),
    statShort: document.getElementById('statShort'),
    statHits: document.getElementById('statHits'),
    statCreated: document.getElementById('statCreated'),
    statLast: document.getElementById('statLast'),
    statExpires: document.getElementById('statExpires'),
    statDest: document.getElementById('statDest'),
    statusPill: document.getElementById('statusPill'),
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),
    toast: document.getElementById('toast'),
  };

  let currentLink = null;
  let toastTimer = null;

  function toast(message) {
    els.toast.hidden = false;
    els.toast.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.hidden = true;
    }, 2200);
  }

  function setLoading(loading) {
    els.shortenBtn.disabled = loading;
    const label = els.shortenBtn.querySelector('.btn-label');
    const spinner = els.shortenBtn.querySelector('.btn-spinner');
    if (label) label.hidden = loading;
    if (spinner) spinner.hidden = !loading;
  }

  function showError(message) {
    if (!message) {
      els.formError.hidden = true;
      els.formError.textContent = '';
      return;
    }
    els.formError.hidden = false;
    els.formError.textContent = message;
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveHistory(items) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY)));
  }

  function upsertHistory(link) {
    const items = loadHistory().filter((x) => x.code !== link.code);
    items.unshift({
      code: link.code,
      shortUrl: link.shortUrl,
      originalUrl: link.originalUrl,
      title: link.title,
      hits: link.hits,
      createdAt: link.createdAt,
      expiresAt: link.expiresAt,
      savedAt: Date.now(),
    });
    saveHistory(items);
    renderHistory();
  }

  function formatDate(value) {
    if (!value) return '—';
    try {
      return new Date(value).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch {
      return String(value);
    }
  }

  function extractCode(input) {
    const raw = String(input || '').trim();
    if (!raw) return '';
    try {
      if (raw.includes('://') || raw.startsWith('/')) {
        const url = raw.includes('://') ? new URL(raw) : new URL(raw, window.location.origin);
        const part = url.pathname.replace(/^\//, '').split('/')[0];
        return part;
      }
    } catch {
      /* fall through */
    }
    return raw.replace(/^\//, '');
  }

  async function api(path, options) {
    const res = await fetch(path, {
      headers: { Accept: 'application/json', ...(options && options.body ? { 'Content-Type': 'application/json' } : {}) },
      ...options,
    });
    let data = null;
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: text };
      }
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function renderResult(link) {
    currentLink = link;
    els.resultCard.hidden = false;
    els.resultTitle.textContent = link.title || 'Your short link';
    els.resultUrl.textContent = link.shortUrl;
    els.resultUrl.href = link.shortUrl;
    els.resultOriginal.textContent = link.originalUrl;
    els.openBtn.href = link.shortUrl;
    els.qrPanel.hidden = true;
    els.resultCard.classList.remove('has-qr');
  }

  function drawQr(text) {
    if (!window.QRCode || !window.QRCode.drawToCanvas) {
      toast('QR generator unavailable');
      return;
    }
    try {
      window.QRCode.drawToCanvas(els.qrCanvas, text, {
        margin: 2,
        foreground: '#0b1220',
        background: '#ffffff',
      });
      els.qrPanel.hidden = false;
      els.resultCard.classList.add('has-qr');
    } catch (err) {
      console.error(err);
      toast('Could not generate QR for this URL');
    }
  }

  function renderHistory() {
    const items = loadHistory();
    if (!items.length) {
      els.historyBody.innerHTML = '<tr class="empty-row"><td colspan="5">No links yet — shorten one above.</td></tr>';
      return;
    }

    els.historyBody.innerHTML = items
      .map((item) => {
        const short = item.shortUrl || `${window.location.origin}/${item.code}`;
        const title = item.title ? `<div class="muted" style="font-size:0.8rem">${escapeHtml(item.title)}</div>` : '';
        return `
          <tr data-code="${escapeAttr(item.code)}">
            <td>
              <a class="mono" href="${escapeAttr(short)}" target="_blank" rel="noopener">${escapeHtml(short.replace(/^https?:\/\//, ''))}</a>
              ${title}
            </td>
            <td class="dest" title="${escapeAttr(item.originalUrl || '')}">${escapeHtml(item.originalUrl || '')}</td>
            <td>${Number(item.hits) || 0}</td>
            <td>${escapeHtml(formatDate(item.createdAt))}</td>
            <td>
              <div class="row-actions">
                <button type="button" class="btn btn-ghost btn-sm" data-action="copy" data-url="${escapeAttr(short)}">Copy</button>
                <button type="button" class="btn btn-ghost btn-sm" data-action="stats" data-code="${escapeAttr(item.code)}">Stats</button>
                <button type="button" class="btn btn-ghost btn-sm btn-danger" data-action="remove" data-code="${escapeAttr(item.code)}">Remove</button>
              </div>
            </td>
          </tr>`;
      })
      .join('');
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/'/g, '&#39;');
  }

  function showStats(link) {
    els.statsCard.hidden = false;
    els.statShort.textContent = link.shortUrl;
    els.statShort.href = link.shortUrl;
    els.statHits.textContent = String(Number(link.hits) || 0);
    els.statCreated.textContent = formatDate(link.createdAt);
    els.statLast.textContent = formatDate(link.lastHitAt);
    els.statExpires.textContent = link.expiresAt ? formatDate(link.expiresAt) : 'Never';
    els.statDest.textContent = link.originalUrl;
    els.statDest.href = link.originalUrl;
    els.lookupInput.value = link.code;
    document.getElementById('lookup').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function fetchStats(code) {
    return api(`/api/stats/${encodeURIComponent(code)}`);
  }

  async function checkHealth() {
    try {
      const data = await api('/health');
      els.statusPill.classList.remove('err');
      els.statusPill.classList.add('ok');
      const bits = ['Online'];
      if (data.db) bits.push('DB');
      if (data.redis) bits.push(data.redisConnected === false ? 'Redis?' : 'Redis');
      els.statusText.textContent = bits.join(' · ');
    } catch {
      els.statusPill.classList.remove('ok');
      els.statusPill.classList.add('err');
      els.statusText.textContent = 'Offline';
    }
  }

  async function refreshHistoryStats() {
    const items = loadHistory();
    if (!items.length) {
      toast('No local history yet');
      return;
    }
    const updated = [];
    for (const item of items) {
      try {
        const stats = await fetchStats(item.code);
        updated.push({
          ...item,
          shortUrl: stats.shortUrl || item.shortUrl,
          originalUrl: stats.originalUrl || item.originalUrl,
          title: stats.title || item.title,
          hits: stats.hits,
          createdAt: stats.createdAt || item.createdAt,
          expiresAt: stats.expiresAt || item.expiresAt,
        });
      } catch {
        updated.push(item);
      }
    }
    saveHistory(updated);
    renderHistory();
    toast('Stats refreshed');
  }

  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    const url = els.urlInput.value.trim();
    if (!url) {
      showError('Paste a URL to shorten.');
      els.urlInput.focus();
      return;
    }

    const body = { url };
    const alias = els.aliasInput.value.trim();
    const title = els.titleInput.value.trim();
    const expiresIn = els.expiresInput.value;
    if (alias) body.customCode = alias;
    if (title) body.title = title;
    if (expiresIn) body.expiresIn = expiresIn;

    setLoading(true);
    try {
      const link = await api('/api/shorten', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      renderResult(link);
      upsertHistory(link);
      toast('Short link created');
      els.aliasInput.value = '';
    } catch (err) {
      showError(err.message || 'Could not shorten URL');
    } finally {
      setLoading(false);
    }
  });

  els.copyBtn.addEventListener('click', async () => {
    if (!currentLink) return;
    try {
      await navigator.clipboard.writeText(currentLink.shortUrl);
      toast('Copied to clipboard');
    } catch {
      toast('Could not copy — select the link manually');
    }
  });

  els.qrBtn.addEventListener('click', () => {
    if (!currentLink) return;
    if (!els.qrPanel.hidden) {
      els.qrPanel.hidden = true;
      els.resultCard.classList.remove('has-qr');
      return;
    }
    drawQr(currentLink.shortUrl);
  });

  els.downloadQrBtn.addEventListener('click', () => {
    if (!currentLink) return;
    const a = document.createElement('a');
    a.download = `linkly-${currentLink.code}.png`;
    a.href = els.qrCanvas.toDataURL('image/png');
    a.click();
  });

  els.statsBtn.addEventListener('click', async () => {
    if (!currentLink) return;
    try {
      const stats = await fetchStats(currentLink.code);
      currentLink = stats;
      showStats(stats);
      upsertHistory(stats);
    } catch (err) {
      toast(err.message || 'Stats unavailable');
    }
  });

  els.lookupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = extractCode(els.lookupInput.value);
    if (!code) {
      toast('Enter a short code first');
      return;
    }
    try {
      const stats = await fetchStats(code);
      showStats(stats);
      upsertHistory(stats);
    } catch (err) {
      els.statsCard.hidden = true;
      toast(err.message || 'Not found');
    }
  });

  els.historyBody.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    const code = btn.getAttribute('data-code');
    const url = btn.getAttribute('data-url');

    if (action === 'copy' && url) {
      try {
        await navigator.clipboard.writeText(url);
        toast('Copied');
      } catch {
        toast('Copy failed');
      }
    }

    if (action === 'stats' && code) {
      try {
        const stats = await fetchStats(code);
        showStats(stats);
        upsertHistory(stats);
      } catch (err) {
        toast(err.message || 'Not found');
      }
    }

    if (action === 'remove' && code) {
      const items = loadHistory().filter((x) => x.code !== code);
      saveHistory(items);
      renderHistory();
      toast('Removed from this browser');
    }
  });

  els.refreshHistoryBtn.addEventListener('click', () => {
    refreshHistoryStats();
  });

  els.clearHistoryBtn.addEventListener('click', () => {
    saveHistory([]);
    renderHistory();
    toast('Local history cleared');
  });

  // Deep-link: /?code=abc or hash stats
  function bootFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code') || params.get('stats');
    if (code) {
      els.lookupInput.value = code;
      els.lookupForm.requestSubmit();
    }
  }

  renderHistory();
  checkHealth();
  setInterval(checkHealth, 60000);
  bootFromQuery();
  els.urlInput.focus();
})();
