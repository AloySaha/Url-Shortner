<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="Linkly — fast modern URL shortener" />
    <meta name="theme-color" content="#0b1220" />
    <title>Linkly — Modern URL Shortener</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%236366f1'/%3E%3Cpath d='M20 32h24M28 22l-8 8 8 8M36 22l8 8-8 8' stroke='white' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E" />
    <script type="module" src="/src/main.js"></script>
    <link rel="stylesheet" href="/src/styles.css" />
  </head>
  <body>
    <div class="bg-grid" aria-hidden="true"></div>
    <div class="bg-glow" aria-hidden="true"></div>

    <header class="topbar">
      <a class="brand" href="/" aria-label="Linkly home">
        <span class="brand-mark" aria-hidden="true">🔗</span>
        <span class="brand-text">Linkly</span>
      </a>
      <nav class="nav">
        <a href="#features">Features</a>
        <a href="#history">History</a>
        <a href="#lookup">Stats</a>
      </nav>
      <div class="status-pill" id="statusPill" title="Service status">
        <span class="status-dot" id="statusDot"></span>
        <span id="statusText">Checking…</span>
      </div>
    </header>

    <main>
      <section class="hero">
        <p class="eyebrow">Ship shorter links in seconds</p>
        <h1>Short links that look sharp<br /><span class="gradient-text">and work hard</span></h1>
        <p class="lede">Custom aliases, tracking, QR codes, and optional expiry — a polished shortener you can run yourself.</p>

        <form class="shorten-card" id="shortenForm" novalidate>
          <div class="url-row">
            <div class="input-wrap">
              <input id="urlInput" name="url" type="url" placeholder="Paste a long URL (https://…)" required />
            </div>
            <button type="submit" class="btn btn-primary" id="shortenBtn">
              <span class="btn-label">Shorten</span>
              <span class="btn-spinner" hidden></span>
            </button>
          </div>

          <details class="advanced" id="advancedDetails">
            <summary>Advanced options</summary>
            <div class="advanced-grid">
              <label class="field">
                <span>Custom alias</span>
                <input id="aliasInput" name="alias" type="text" maxlength="32" placeholder="my-campaign" pattern="[A-Za-z0-9_-]{3,32}" />
              </label>
              <label class="field">
                <span>Title</span>
                <input id="titleInput" name="title" type="text" maxlength="120" placeholder="Optional label" />
              </label>
              <label class="field">
                <span>Expires</span>
                <select id="expiresInput" name="expiresIn">
                  <option value="">Never</option>
                  <option value="30m">30 minutes</option>
                  <option value="1h">1 hour</option>
                  <option value="12h">12 hours</option>
                  <option value="1d">1 day</option>
                  <option value="7d">7 days</option>
                  <option value="30d">30 days</option>
                </select>
              </label>
            </div>
          </details>

          <p class="form-error" id="formError" role="alert" hidden></p>
        </form>

        <div class="result-card" id="resultCard" hidden>
          <div class="result-main">
            <div class="result-meta">
              <span class="badge">Ready</span>
              <span class="result-title" id="resultTitle"></span>
            </div>
            <a class="result-url" id="resultUrl" href="#" target="_blank" rel="noopener"></a>
            <p class="result-original" id="resultOriginal"></p>
            <div class="result-actions">
              <button type="button" class="btn btn-secondary" id="copyBtn">Copy</button>
              <button type="button" class="btn btn-secondary" id="qrBtn">QR code</button>
              <button type="button" class="btn btn-secondary" id="statsBtn">View stats</button>
              <a class="btn btn-ghost" id="openBtn" href="#" target="_blank" rel="noopener">Open</a>
            </div>
          </div>
          <div class="qr-panel" id="qrPanel" hidden>
            <canvas id="qrCanvas" width="180" height="180" aria-label="QR code"></canvas>
            <p>Scan to open the short link</p>
            <button type="button" class="btn btn-ghost btn-sm" id="downloadQrBtn">Download PNG</button>
          </div>
        </div>
      </section>

      <section class="features" id="features">
        <h2>Everything you need from a modern shortener</h2>
        <div class="feature-grid">
          <article class="feature"><div class="feature-icon">⚡</div><h3>Instant shortening</h3><p>Paste any URL and receive a clean short link instantly.</p></article>
          <article class="feature"><div class="feature-icon">✨</div><h3>Custom aliases</h3><p>Use memorable paths like <code>/launch</code> or <code>/docs-v2</code>.</p></article>
          <article class="feature"><div class="feature-icon">📊</div><h3>Click analytics</h3><p>Track hits, creation time, and recent activity.</p></article>
          <article class="feature"><div class="feature-icon">📱</div><h3>QR codes</h3><p>Generate and download a QR for the short link.</p></article>
          <article class="feature"><div class="feature-icon">⏳</div><h3>Optional expiry</h3><p>Set a time window for campaign links.</p></article>
          <article class="feature"><div class="feature-icon">🛡️</div><h3>Built for Docker</h3><p>Designed to run with Postgres and Redis behind the API.</p></article>
        </div>
      </section>

      <section class="panel-section" id="history">
        <div class="section-head">
          <div>
            <h2>Your recent links</h2>
            <p class="muted">Saved in this browser · refresh stats anytime</p>
          </div>
          <div class="section-actions">
            <button type="button" class="btn btn-ghost btn-sm" id="refreshHistoryBtn">Refresh stats</button>
            <button type="button" class="btn btn-ghost btn-sm" id="clearHistoryBtn">Clear local</button>
          </div>
        </div>
        <div class="table-wrap">
          <table class="links-table" id="historyTable">
            <thead>
              <tr><th>Short link</th><th>Destination</th><th>Clicks</th><th>Created</th><th></th></tr>
            </thead>
            <tbody id="historyBody"><tr class="empty-row"><td colspan="5">No links yet — shorten one above.</td></tr></tbody>
          </table>
        </div>
      </section>

      <section class="panel-section" id="lookup">
        <div class="section-head">
          <div>
            <h2>Look up stats</h2>
            <p class="muted">Paste a short code or full short URL</p>
          </div>
        </div>
        <form class="lookup-row" id="lookupForm">
          <input id="lookupInput" type="text" placeholder="abc123 or http://localhost:3001/abc123" />
          <button type="submit" class="btn btn-secondary">Get stats</button>
        </form>
        <div class="stats-card" id="statsCard" hidden>
          <div class="stats-grid">
            <div><span class="stat-label">Short URL</span><a id="statShort" href="#" target="_blank" rel="noopener"></a></div>
            <div><span class="stat-label">Clicks</span><strong id="statHits">0</strong></div>
            <div><span class="stat-label">Created</span><span id="statCreated">—</span></div>
            <div><span class="stat-label">Last click</span><span id="statLast">—</span></div>
            <div><span class="stat-label">Expires</span><span id="statExpires">Never</span></div>
            <div class="stat-full"><span class="stat-label">Destination</span><a id="statDest" href="#" target="_blank" rel="noopener"></a></div>
          </div>
        </div>
      </section>
    </main>

    <footer class="footer"><p>Linkly · self-hosted URL shortener · Express + Postgres + Redis</p></footer>
    <div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
  </body>
</html>
