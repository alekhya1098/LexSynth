// ── LexSynth v4 — Full-featured Legal Research Synthesizer ─────────────────

const KEYS = { apiKey: 'ls_api_key', searchKey: 'ls_search_key', persist: 'ls_persist', theme: 'ls_theme' };
const BACKEND = window.LEXSYNTH_BACKEND || 'http://localhost:8000';
let _backendAvailable = false;
let _lastResult = null;

const ANGLES = [
  { id: 'statutory',       label: '📜 Statutory' },
  { id: 'caselaw',         label: '⚖️ Case Law' },
  { id: 'practical',       label: '🏢 Practical' },
  { id: 'counterargument', label: '🔄 Counter-Arguments' },
  { id: 'recent',          label: '🆕 Recent Developments' },
];

// ── Init ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  // Theme
  const savedTheme = localStorage.getItem(KEYS.theme) || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  document.getElementById('theme-toggle').textContent = savedTheme === 'dark' ? '🌙' : '☀️';

  // API key persistence
  const persist = localStorage.getItem(KEYS.persist) === 'true';
  document.getElementById('persist-key').checked = persist;
  document.getElementById('api-base').value   = 'https://api.groq.com/openai/v1';
  document.getElementById('model-name').value = 'llama-3.1-8b-instant';
  document.getElementById('api-key').value    = persist
    ? (localStorage.getItem(KEYS.apiKey) || sessionStorage.getItem(KEYS.apiKey) || '')
    : (sessionStorage.getItem(KEYS.apiKey) || '');
  document.getElementById('search-key').value = persist
    ? (localStorage.getItem(KEYS.searchKey) || sessionStorage.getItem(KEYS.searchKey) || '')
    : (sessionStorage.getItem(KEYS.searchKey) || '');

  document.getElementById('persist-key').addEventListener('change', (e) => {
    localStorage.setItem(KEYS.persist, e.target.checked);
    if (!e.target.checked) {
      localStorage.removeItem(KEYS.apiKey);
      localStorage.removeItem(KEYS.searchKey);
    }
  });

  checkSharedMemo();
  checkBackend();
});

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem(KEYS.theme, next);
  document.getElementById('theme-toggle').textContent = next === 'dark' ? '🌙' : '☀️';
}

function saveSettings() {
  const key    = document.getElementById('api-key').value.trim();
  const search = document.getElementById('search-key').value.trim();
  const persist = document.getElementById('persist-key').checked;
  sessionStorage.setItem(KEYS.apiKey, key);
  sessionStorage.setItem(KEYS.searchKey, search);
  if (persist) {
    localStorage.setItem(KEYS.apiKey, key);
    localStorage.setItem(KEYS.searchKey, search);
  }
}

function getConfig() {
  return {
    apiBase:   document.getElementById('api-base').value.trim()   || 'https://api.groq.com/openai/v1',
    apiKey:    document.getElementById('api-key').value.trim(),
    model:     document.getElementById('model-name').value.trim() || 'llama-3.1-8b-instant',
    searchKey: document.getElementById('search-key').value.trim(),
  };
}

// ── Backend health ────────────────────────────────────────────────────────────
async function checkBackend() {
  try {
    const res = await fetch(`${BACKEND}/api/status`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      _backendAvailable = true;
      document.getElementById('rag-status-bar').classList.remove('hidden');
      document.getElementById('rag-indicator').innerHTML =
        `<span class="rag-badge on">🟢 RAG Backend Online</span> — ${data.embed_model} · ${data.indexed_chunks} chunks indexed`;
      document.getElementById('history-bar').classList.remove('hidden');
      loadHistory();
    }
  } catch {
    _backendAvailable = false;
    document.getElementById('rag-status-bar').classList.remove('hidden');
    document.getElementById('rag-indicator').innerHTML =
      `<span class="rag-badge off">🔴 RAG Backend Offline</span> — running in direct mode`;
    document.getElementById('ingest-btn').classList.add('hidden');
  }
}

async function triggerIngest() {
  const question = document.getElementById('legal-question').value.trim();
  const jurisdiction = document.getElementById('jurisdiction').options[document.getElementById('jurisdiction').selectedIndex].text;
  if (!question) { showError('Enter a question first.'); return; }
  const btn = document.getElementById('ingest-btn');
  btn.textContent = '⏳ Ingesting...'; btn.disabled = true;
  try {
    const res = await fetch(`${BACKEND}/api/ingest`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: question, jurisdiction, max_per_source: 8 }),
    });
    const data = await res.json();
    btn.textContent = `✓ ${data.indexed} chunks indexed`;
    await checkBackend();
  } catch (e) {
    showError(`Ingest failed: ${e.message}`);
    btn.textContent = '⬇️ Ingest Legal Docs';
  } finally { btn.disabled = false; }
}

// ── History ───────────────────────────────────────────────────────────────────
async function loadHistory() {
  try {
    const res = await fetch(`${BACKEND}/api/history?limit=30`);
    const data = await res.json();
    const sessions = data.sessions || [];
    const countEl = document.getElementById('history-count');
    if (countEl) countEl.textContent = sessions.length ? `(${sessions.length})` : '';
    renderHistoryList(sessions);
  } catch { }
}

function renderHistoryList(sessions) {
  const list = document.getElementById('history-list');
  if (!list) return;
  if (!sessions.length) { list.innerHTML = '<p class="history-empty">No history yet.</p>'; return; }
  list.innerHTML = sessions.map(s => `
    <div class="history-item" onclick="loadSession(${s.id})">
      <div class="history-q">${escHtml(s.question.slice(0, 80))}${s.question.length > 80 ? '…' : ''}</div>
      <div class="history-meta">${escHtml(s.jurisdiction || '')} · ${escHtml(s.ts?.slice(0,10) || '')}</div>
      <button class="history-del" onclick="deleteSession(event,${s.id})">✕</button>
    </div>`).join('');
}

function toggleHistory() {
  document.getElementById('history-panel').classList.toggle('hidden');
}

async function loadSession(id) {
  try {
    const res = await fetch(`${BACKEND}/api/history/${id}`);
    const s = await res.json();
    document.getElementById('legal-question').value = s.question || '';
    if (s.angles) renderAngles(s.angles);
    if (s.accuracy) renderAccuracy(s.accuracy);
    if (s.memo) renderMemo(s.memo, s.question, s.jurisdiction, s.sources || []);
    if (s.sources) renderSources(s.sources);
    document.getElementById('results-section').classList.remove('hidden');
    document.getElementById('results-section').scrollIntoView({ behavior: 'smooth' });
    toggleHistory();
  } catch (e) { showError(`Could not load session: ${e.message}`); }
}

async function deleteSession(e, id) {
  e.stopPropagation();
  await fetch(`${BACKEND}/api/history/${id}`, { method: 'DELETE' });
  loadHistory();
}

// ── Angle picker ─────────────────────────────────────────────────────────────
function renderAnglePicker() {
  document.getElementById('angle-checkboxes').innerHTML = ANGLES.map(a => `
    <label class="angle-check">
      <input type="checkbox" value="${a.id}" checked />
      ${a.label}
    </label>`).join('');
}

function getSelectedAngles() {
  // Angle picker removed from UI — always run all angles
  return ANGLES;
}

// ── Speech to text ────────────────────────────────────────────────────────────
let _recognition = null;
let _listening = false;
let _stopRequested = false;
let _finalTranscript = '';

function toggleSpeech() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showError('Speech recognition is not supported in this browser. Try Chrome or Edge.');
    return;
  }

  if (_listening) {
    // User clicked to stop — set flag BEFORE calling stop()
    _stopRequested = true;
    _listening = false;
    _recognition?.stop();
    return;
  }

  _recognition = new SpeechRecognition();
  _recognition.lang = 'en-US';
  _recognition.continuous = true;
  _recognition.interimResults = true;

  const btn = document.getElementById('mic-btn');
  const textarea = document.getElementById('legal-question');

  _finalTranscript = textarea.value;
  _stopRequested = false;

  _recognition.onstart = () => {
    _listening = true;
    btn.classList.add('mic-active');
    btn.textContent = '🔴';
    btn.title = 'Click to stop';
    showMicStatus('Listening… speak your question');
  };

  _recognition.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) {
        _finalTranscript += (_finalTranscript ? ' ' : '') + t.trim();
      } else {
        interim += t;
      }
    }
    textarea.value = _finalTranscript + (interim ? ' ' + interim : '');
    showMicStatus(interim ? `Hearing: "${interim}"` : 'Listening…');
  };

  _recognition.onerror = (e) => {
    if (e.error === 'no-speech') {
      showMicStatus('No speech detected — still listening…');
      return;
    }
    if (e.error === 'aborted') return;
    _stopRequested = true;
    _listening = false;
    resetMicBtn();
    showError(`Microphone error: ${e.error}`);
  };

  _recognition.onend = () => {
    // Only auto-restart if user did NOT click stop
    if (!_stopRequested && _listening) {
      try { _recognition.start(); return; } catch { }
    }
    _listening = false;
    resetMicBtn();
    textarea.value = _finalTranscript.trim();
  };

  _recognition.start();
}

function resetMicBtn() {
  const btn = document.getElementById('mic-btn');
  btn.classList.remove('mic-active');
  btn.textContent = '🎤';
  btn.title = 'Speak your question';
  hideMicStatus();
}

function showMicStatus(msg) {
  let el = document.getElementById('mic-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'mic-status';
    el.className = 'mic-status';
    document.querySelector('.query-box').appendChild(el);
  }
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideMicStatus() {
  document.getElementById('mic-status')?.classList.add('hidden');
}


// ── Jurisdiction auto-detect ──────────────────────────────────────────────────
const JURISDICTION_MAP = [
  { keywords: ['california', ' ca ', 'ca law', 'ca court'], value: 'california' },
  { keywords: ['new york', 'ny law', 'nyc'], value: 'new-york' },
  { keywords: ['texas', ' tx '], value: 'texas' },
  { keywords: ['florida', ' fl '], value: 'florida' },
  { keywords: ['united kingdom', ' uk ', 'england', 'british', 'wales', 'scotland'], value: 'uk' },
  { keywords: ['european union', ' eu ', 'europe', 'gdpr'], value: 'eu' },
  { keywords: ['canada', 'canadian', 'ontario', 'quebec', 'british columbia'], value: 'canada' },
  { keywords: ['australia', 'australian', 'nsw', 'victoria', 'queensland'], value: 'australia' },
];
let _autoDetected = false;

function autoDetectJurisdiction(text) {
  const lower = ` ${text.toLowerCase()} `;
  const sel = document.getElementById('jurisdiction');
  for (const { keywords, value } of JURISDICTION_MAP) {
    if (keywords.some(k => lower.includes(k))) {
      if (sel.value !== value) {
        sel.value = value;
        showJurisdictionHint(sel.options[sel.selectedIndex].text);
        _autoDetected = true;
      }
      return;
    }
  }
  if (_autoDetected) { sel.value = 'general'; _autoDetected = false; hideJurisdictionHint(); }
}

function showJurisdictionHint(name) {
  let el = document.getElementById('jurisdiction-hint');
  if (!el) {
    el = document.createElement('div');
    el.id = 'jurisdiction-hint';
    el.className = 'jurisdiction-hint';
    document.querySelector('.query-controls').after(el);
  }
  el.innerHTML = `🌍 Jurisdiction auto-detected: <strong>${escHtml(name)}</strong> <button onclick="hideJurisdictionHint()">✕</button>`;
  el.classList.remove('hidden');
}
function hideJurisdictionHint() { document.getElementById('jurisdiction-hint')?.classList.add('hidden'); }

// ── New Query ─────────────────────────────────────────────────────────────────
function newQuery() {
  document.getElementById('legal-question').value = '';
  ['results-section','progress-section','skeleton-section','contradiction-panel',
   'rag-chunks-panel','ragas-panel','plain-english-panel'].forEach(id => {
    document.getElementById(id)?.classList.add('hidden');
  });
  document.getElementById('compare-results')?.classList.add('hidden');
  document.getElementById('followup-thread').innerHTML = '';
  hideJurisdictionHint();
  _autoDetected = false;
  document.getElementById('legal-question').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Confidence trend chart ────────────────────────────────────────────────────
async function loadTrendChart() {
  if (!_backendAvailable) return;
  try {
    const res = await fetch(`${BACKEND}/api/history?limit=10`);
    const data = await res.json();
    const sessions = (data.sessions || []).reverse();
    if (sessions.length < 2) return;
    const points = (await Promise.all(sessions.map(async s => {
      try {
        const r = await fetch(`${BACKEND}/api/history/${s.id}`);
        const d = await r.json();
        const acc = d.accuracy;
        const score = acc ? Math.round(((acc.source_agreement?.score||50)+(acc.legal_certainty?.score||50)+(acc.jurisdiction_clarity?.score||50))/3) : 50;
        return { label: s.question.slice(0,18)+'…', score };
      } catch { return null; }
    }))).filter(Boolean);
    if (points.length < 2) return;
    renderTrendChart(points);
    document.getElementById('trend-panel').classList.remove('hidden');
  } catch { }
}

function renderTrendChart(points) {
  const canvas = document.getElementById('trend-chart');
  const ctx = canvas.getContext('2d');
  const W = canvas.parentElement.offsetWidth || 860;
  const H = 120;
  canvas.width = W; canvas.height = H;
  const pad = { l:40, r:20, t:16, b:36 };
  const cW = W - pad.l - pad.r, cH = H - pad.t - pad.b;
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const gridC = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
  const textC = isDark ? '#8892b0' : '#5a6380';
  ctx.clearRect(0, 0, W, H);
  ctx.font = '10px system-ui'; ctx.fillStyle = textC; ctx.textAlign = 'right';
  [25,50,75,100].forEach(v => {
    const y = pad.t + cH - (v/100)*cH;
    ctx.strokeStyle = gridC; ctx.beginPath(); ctx.moveTo(pad.l,y); ctx.lineTo(pad.l+cW,y); ctx.stroke();
    ctx.fillText(v, pad.l-4, y+3);
  });
  const step = cW / (points.length-1);
  const xs = points.map((_,i) => pad.l + i*step);
  const ys = points.map(p => pad.t + cH - (p.score/100)*cH);
  const grad = ctx.createLinearGradient(0,pad.t,0,pad.t+cH);
  grad.addColorStop(0, isDark?'rgba(79,124,255,0.18)':'rgba(79,124,255,0.12)');
  grad.addColorStop(1,'rgba(79,124,255,0)');
  ctx.beginPath(); ctx.moveTo(xs[0],ys[0]);
  xs.forEach((x,i) => { if(i>0) ctx.lineTo(x,ys[i]); });
  ctx.lineTo(xs[xs.length-1],pad.t+cH); ctx.lineTo(xs[0],pad.t+cH); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();
  ctx.beginPath(); ctx.strokeStyle='#4f7cff'; ctx.lineWidth=2;
  xs.forEach((x,i) => i===0 ? ctx.moveTo(x,ys[i]) : ctx.lineTo(x,ys[i])); ctx.stroke();
  ctx.textAlign='center';
  points.forEach((p,i) => {
    ctx.beginPath(); ctx.arc(xs[i],ys[i],4,0,Math.PI*2);
    ctx.fillStyle='#7c5cfc'; ctx.fill();
    ctx.strokeStyle=isDark?'#1a1d27':'#fff'; ctx.lineWidth=1.5; ctx.stroke();
    ctx.fillStyle=textC; ctx.font='10px system-ui';
    ctx.fillText(p.score, xs[i], ys[i]-8);
    ctx.fillText(p.label.slice(0,12), xs[i], H-4);
  });
}

let _rateLimitQueue = Promise.resolve();

function queuedLLMCall(fn) {
  _rateLimitQueue = _rateLimitQueue.then(() => fn()).catch(() => fn());
  return _rateLimitQueue;
}

function showQueueMsg(msg) {
  const el = document.getElementById('queue-indicator');
  const txt = document.getElementById('queue-msg');
  if (el) el.classList.remove('hidden');
  if (txt) txt.textContent = msg;
}
function hideQueueMsg() {
  document.getElementById('queue-indicator')?.classList.add('hidden');
}

// ── LLM call with retry + queue indicator ────────────────────────────────────
async function callLLM(messages, cfg, retries = 4) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${cfg.apiBase}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, messages, temperature: 0.4, max_tokens: 1024 }),
    });
    if (res.status === 429) {
      const errBody = await res.json().catch(() => ({}));
      const msg = errBody?.error?.message || '';
      const waitMatch = msg.match(/try again in ([\d.]+)s/i);
      const waitSec = waitMatch ? Math.ceil(parseFloat(waitMatch[1])) + 1 : (attempt + 1) * 8;
      if (attempt < retries) {
        showQueueMsg(`Rate limit — retrying in ${waitSec}s (attempt ${attempt+1}/${retries})...`);
        await new Promise(r => setTimeout(r, waitSec * 1000));
        hideQueueMsg();
        continue;
      }
      throw new Error('Rate limit exceeded. Please wait a moment and try again.');
    }
    if (!res.ok) { const err = await res.text(); throw new Error(`LLM API error ${res.status}: ${err}`); }
    return (await res.json()).choices[0].message.content;
  }
}

async function searchWeb(query, searchKey) {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': searchKey },
    body: JSON.stringify({ q: query, num: 8 }),
  });
  if (!res.ok) throw new Error(`Search API error ${res.status}`);
  return (await res.json()).organic || [];
}

async function simulateSearch(question, jurisdiction, cfg) {
  const content = await callLLM([{ role: 'user', content:
    `Generate 6 relevant legal sources as JSON array: [{"title":"...","url":"...","snippet":"..."}]
Jurisdiction: ${jurisdiction}
Question: ${question}` }], cfg);
  try { return JSON.parse(content.match(/\[[\s\S]*\]/)?.[0]); }
  catch { return [{ title: 'Simulated Research', url: '#', snippet: content.slice(0, 200) }]; }
}

// ── Step helpers ─────────────────────────────────────────────────────────────
function setStep(id, state, detail = '') {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `step ${state}`;
  el.querySelector('.step-status').textContent = detail;
}

function setAngleProgress(done, total) {
  const wrap = document.querySelector('.angle-progress-wrap');
  if (wrap) wrap.classList.remove('hidden');
  const pct = Math.round((done / total) * 100);
  const fill = document.getElementById('angle-progress-fill');
  const txt  = document.getElementById('angle-progress-text');
  if (fill) fill.style.width = `${pct}%`;
  if (txt)  txt.textContent = `${done} / ${total}`;
}

// ── Markdown → HTML ──────────────────────────────────────────────────────────
function mdToHtml(md) {
  return md
    .replace(/\[([R]?\d+)\]/g, '<sup class="cite-badge">[$1]</sup>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^---$/gm, '<hr>')
    .replace(/^\* (.+)$/gm, '<li>$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`)
    .replace(/\n{2,}/g, '</p><p>')
    .trim();
}

// ── Main research flow ───────────────────────────────────────────────────────
async function startResearch() {
  saveSettings();
  const cfg = getConfig();
  const question = document.getElementById('legal-question').value.trim();
  const jurisdiction = document.getElementById('jurisdiction').options[document.getElementById('jurisdiction').selectedIndex].text;
  const selectedAngles = getSelectedAngles();

  // Validation
  if (!question) { showError('Please enter a legal question.'); return; }
  if (question.length < 10) { showError('Question is too short — please be more specific.'); return; }
  if (!cfg.apiKey) { showError('Please enter your API key in settings.'); document.getElementById('settings-details').open = true; return; }
  if (!selectedAngles.length) { showError('Select at least one research angle.'); return; }

  // Reset UI
  document.getElementById('results-section').classList.add('hidden');
  document.getElementById('contradiction-panel').classList.add('hidden');
  document.getElementById('rag-chunks-panel').classList.add('hidden');
  document.getElementById('ragas-panel').classList.add('hidden');
  document.getElementById('plain-english-panel').classList.add('hidden');
  document.getElementById('followup-thread').innerHTML = '';
  document.getElementById('skeleton-section').classList.remove('hidden');
  document.getElementById('progress-section').classList.remove('hidden');
  document.getElementById('research-btn').disabled = true;
  document.getElementById('btn-text').textContent = 'Researching...';
  document.getElementById('btn-spinner').classList.remove('hidden');
  document.querySelector('.angle-progress-wrap')?.classList.add('hidden');
  hideQueueMsg();
  ['step-search','step-extract','step-angles','step-accuracy','step-memo'].forEach(s => setStep(s, ''));

  let sources = [];
  try {
    setStep('step-search', 'active');
    if (cfg.searchKey) {
      const raw = await searchWeb(`${question} ${jurisdiction} law`, cfg.searchKey);
      sources = raw.slice(0, 8).map((r, i) => ({ num: i+1, title: r.title, url: r.link, snippet: r.snippet || '' }));
    } else {
      const sim = await simulateSearch(question, jurisdiction, cfg);
      sources = sim.map((r, i) => ({ num: i+1, title: r.title, url: r.url, snippet: r.snippet }));
    }
    setStep('step-search', 'done', `${sources.length} sources`);
    setStep('step-extract', 'active');
    renderSources(sources);
    setStep('step-extract', 'done');
  } catch (e) {
    setStep('step-search', 'error');
    showError(`Search failed: ${e.message}`);
    resetBtn(); return;
  }

  document.getElementById('skeleton-section').classList.add('hidden');

  try {
    if (_backendAvailable) {
      await runWithWebSocket(question, jurisdiction, selectedAngles, sources, cfg);
    } else {
      await runDirect(question, jurisdiction, selectedAngles, sources, cfg);
    }
    document.getElementById('results-section').classList.remove('hidden');
    document.getElementById('results-section').scrollIntoView({ behavior: 'smooth' });
    if (_backendAvailable) { loadHistory(); loadTrendChart(); }
  } catch (err) {
    const active = ['step-search','step-extract','step-angles','step-accuracy','step-memo']
      .find(s => document.getElementById(s)?.classList.contains('active'));
    if (active) setStep(active, 'error');
    showError(err.message);
  } finally { resetBtn(); hideQueueMsg(); }
}

function resetBtn() {
  document.getElementById('research-btn').disabled = false;
  document.getElementById('btn-text').textContent = '🔍 Research';
  document.getElementById('btn-spinner').classList.add('hidden');
  document.getElementById('skeleton-section').classList.add('hidden');
}

// ── WebSocket streaming ───────────────────────────────────────────────────────
function runWithWebSocket(question, jurisdiction, selectedAngles, sources, cfg) {
  return new Promise((resolve, reject) => {
    const wsUrl = BACKEND.replace('https://', 'wss://').replace('http://', 'ws://');
    const ws = new WebSocket(`${wsUrl}/ws/research`);
    ws.onopen = () => ws.send(JSON.stringify({
      question, jurisdiction,
      angles: selectedAngles.map(a => a.id),
      web_sources: sources,
      api_key: cfg.apiKey,
      top_k: 6,
    }));

    const angleResults = [];
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      switch (msg.event) {
        case 'step': setStep(`step-${msg.step}`, msg.state, msg.detail || ''); break;
        case 'angle_progress': setAngleProgress(msg.done, msg.total); break;
        case 'angle_done':
          angleResults.push(msg.angle);
          renderAngles(angleResults);
          setAngleProgress(msg.done, msg.total);
          document.getElementById('results-section').classList.remove('hidden');
          break;
        case 'rag_chunks':
          renderRagChunks(msg.chunks);
          document.getElementById('rag-chunks-panel').classList.remove('hidden');
          break;
        case 'contradictions':
          if (msg.items?.length) renderContradictions(msg.items);
          break;
        case 'accuracy': renderAccuracy(msg.data); break;
        case 'done':
          renderMemo(msg.memo, question, jurisdiction, sources);
          _lastResult = { question, answer: msg.memo, contexts: [], apiKey: cfg.apiKey };
          document.getElementById('ragas-panel').classList.remove('hidden');
          ws.close(); resolve(); break;
        case 'error': ws.close(); reject(new Error(msg.message)); break;
      }
    };
    ws.onerror = () => reject(new Error('WebSocket connection failed'));
    ws.onclose = (e) => { if (e.code !== 1000 && e.code !== 1005) reject(new Error('Connection closed unexpectedly')); };
  });
}

// ── Direct mode with error recovery ──────────────────────────────────────────
async function runDirect(question, jurisdiction, selectedAngles, sources, cfg) {
  const sourceText = sources.map(s => `[${s.num}] ${s.title}\n${s.url}\n${s.snippet}`).join('\n\n');

  setStep('step-angles', 'active');
  setAngleProgress(0, selectedAngles.length);
  const angleResults = [];

  for (let i = 0; i < selectedAngles.length; i++) {
    const a = selectedAngles[i];
    let text;
    try {
      text = await callLLM([{ role: 'user', content: buildDirectAnglePrompt(a.id, question, jurisdiction, sourceText) }], cfg);
    } catch (e) {
      // Error recovery: skip failed angle, continue with rest
      text = `⚠️ This angle could not be analyzed: ${e.message}`;
    }
    angleResults.push({ id: a.id, label: a.label, text });
    setAngleProgress(i + 1, selectedAngles.length);
    renderAngles(angleResults);
    document.getElementById('results-section').classList.remove('hidden');
    if (i < selectedAngles.length - 1) await new Promise(r => setTimeout(r, 5000));
  }
  setStep('step-angles', 'done', `${angleResults.length} angles`);

  setStep('step-accuracy', 'active');
  let accuracy;
  try {
    const raw = await callLLM([{ role: 'user', content: buildAccuracyPrompt(question, jurisdiction, sourceText, angleResults) }], cfg);
    accuracy = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0]);
  } catch { accuracy = fallbackAccuracy(); } // graceful fallback
  renderAccuracy(accuracy);
  setStep('step-accuracy', 'done');

  setStep('step-memo', 'active');
  let memoText;
  try {
    memoText = await callLLM([{ role: 'user', content: buildMemoPrompt(question, jurisdiction, angleResults) }], cfg);
  } catch (e) {
    memoText = `Memo generation failed: ${e.message}\n\nPlease try again or reduce the number of angles selected.`;
  }
  renderMemo(memoText, question, jurisdiction, sources);
  setStep('step-memo', 'done');
  _lastResult = { question, answer: memoText, contexts: [], apiKey: cfg.apiKey };
}

function buildDirectAnglePrompt(id, q, j, sources) {
  const focus = {
    statutory: 'applicable statutes, codes, regulations with citations',
    caselaw: 'relevant court decisions and precedents',
    practical: 'real-world compliance steps and risk assessment',
    counterargument: 'exceptions, opposing arguments, legal uncertainty',
    recent: 'recent legislative and judicial developments',
  };
  return `Legal analyst. IRAC reasoning. Analyze: ${focus[id] || 'the legal question'}.
Cite sources inline as [1],[2]. Jurisdiction: ${j}\nQuestion: ${q}\nSources:\n${sources}`;
}

function buildAccuracyPrompt(q, j, sources, angles) {
  return `Legal fact-checker. Respond ONLY with JSON (no markdown):
{"confidence":"high"|"medium"|"low","verdict":"...","source_agreement":{"score":0-100,"note":"..."},"legal_certainty":{"score":0-100,"note":"..."},"jurisdiction_clarity":{"score":0-100,"note":"..."},"recency":{"score":0-100,"note":"..."},"caveats":"..."}
Question: ${q} | Jurisdiction: ${j}
Sources: ${sources.slice(0,500)}
Analysis: ${angles.map(a => a.text.slice(0,200)).join(' | ')}`;
}

function buildMemoPrompt(q, j, angles) {
  return `Senior legal analyst. Formal legal research memo with IRAC reasoning.
Question: ${q} | Jurisdiction: ${j}
Angles:\n${angles.map(a => `=== ${a.label} ===\n${a.text}`).join('\n\n')}
Sections: MEMORANDUM, TO/FROM/DATE/RE, Executive Summary, Issue, Short Answer, Applicable Law, Analysis, Counter-Arguments, Recent Developments, Conclusion, Disclaimer.
Use inline citations [1],[2]. End with: this is not legal advice.`;
}

function fallbackAccuracy() {
  return { confidence:'medium', verdict:'Assessment unavailable.',
    source_agreement:{score:50,note:'N/A'}, legal_certainty:{score:50,note:'N/A'},
    jurisdiction_clarity:{score:50,note:'N/A'}, recency:{score:50,note:'N/A'},
    caveats:'Consult a licensed attorney.' };
}

// ── Render helpers ───────────────────────────────────────────────────────────
function renderSources(sources) {
  document.getElementById('sources-list').innerHTML = sources.map(s => `
    <div class="source-item">
      <span class="source-num">[${s.num}]</span>
      <div class="source-info">
        <div class="source-title">${escHtml(s.title)}</div>
        <div class="source-url"><a href="${escHtml(s.url)}" target="_blank" rel="noopener">${escHtml(s.url)}</a></div>
        ${s.snippet ? `<div class="source-snippet">${escHtml(s.snippet)}</div>` : ''}
      </div>
    </div>`).join('');
}

function renderRagChunks(chunks) {
  document.getElementById('rag-chunks-list').innerHTML = chunks.map((c, i) => {
    const m = c.metadata || {};
    return `<div class="rag-chunk">
      <div class="rag-chunk-meta">
        <span class="rag-badge-ref">[R${i+1}]</span>
        <span class="rag-case">${escHtml(m.case_name || 'Unknown')}</span>
        <span class="rag-court">${escHtml(m.court || '')}</span>
        <span class="rag-score">score: ${c.score}</span>
        ${m.url ? `<a href="${escHtml(m.url)}" target="_blank" rel="noopener" class="rag-link">↗</a>` : ''}
      </div>
      <div class="rag-chunk-text">${escHtml(c.text.slice(0, 300))}${c.text.length > 300 ? '…' : ''}</div>
    </div>`;
  }).join('');
}

function renderAccuracy(data) {
  const badge = document.getElementById('confidence-badge');
  badge.textContent = `${(data.confidence||'medium').toUpperCase()} CONFIDENCE`;
  badge.className = data.confidence || 'medium';
  document.getElementById('accuracy-verdict').innerHTML =
    `<p>${escHtml(data.verdict||'')}</p>` +
    (data.caveats ? `<p class="accuracy-caveat">⚠️ ${escHtml(data.caveats)}</p>` : '');
  const metrics = [
    { key:'source_agreement',     label:'Source Agreement' },
    { key:'legal_certainty',      label:'Legal Certainty' },
    { key:'jurisdiction_clarity', label:'Jurisdiction Clarity' },
    { key:'recency',              label:'Source Recency' },
  ];
  document.getElementById('accuracy-breakdown').innerHTML = metrics.map(m => {
    const item = data[m.key] || { score:0, note:'' };
    const score = item.score || 0;
    const tier = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';
    return `<div class="accuracy-item">
      <div class="acc-label">${m.label}</div>
      <div class="acc-value">${escHtml(item.note)}</div>
      <div class="acc-bar-wrap"><div class="acc-bar ${tier}" style="width:${score}%"></div></div>
    </div>`;
  }).join('');
}

function renderAngles(angleResults) {
  const tabs = document.getElementById('angles-tabs');
  const content = document.getElementById('angles-content');
  const activeId = document.querySelector('.angle-tab.active')?.id?.replace('tab-', '') || angleResults[0]?.id;
  tabs.innerHTML = angleResults.map(a =>
    `<div class="angle-tab ${a.id===activeId?'active':''}" onclick="switchAngle('${a.id}')" id="tab-${a.id}">${a.label}</div>`
  ).join('');
  content.innerHTML = angleResults.map(a =>
    `<div class="angle-pane ${a.id===activeId?'active':''}" id="pane-${a.id}">
      <div class="angle-pane-header">
        <h4>${a.label}</h4>
        <button class="copy-angle-btn" onclick="copyAngle('${a.id}')">📋 Copy</button>
      </div>
      <div>${mdToHtml(a.text)}</div>
    </div>`
  ).join('');
}

function switchAngle(id) {
  document.querySelectorAll('.angle-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.angle-pane').forEach(p => p.classList.remove('active'));
  document.getElementById(`tab-${id}`)?.classList.add('active');
  document.getElementById(`pane-${id}`)?.classList.add('active');
}

function copyAngle(id) {
  const pane = document.getElementById(`pane-${id}`);
  const text = pane?.querySelector('div:last-child')?.innerText || '';
  navigator.clipboard.writeText(text).then(() => {
    const btn = pane?.querySelector('.copy-angle-btn');
    if (btn) { btn.textContent = '✓ Copied'; setTimeout(() => btn.textContent = '📋 Copy', 2000); }
  });
}

function renderContradictions(items) {
  document.getElementById('contradiction-list').innerHTML = items.map(c => `
    <div class="contradiction-item severity-${c.severity}">
      <span class="contra-severity">${c.severity.toUpperCase()}</span>
      <span class="contra-angles">${escHtml(c.angle1)} vs ${escHtml(c.angle2)}</span>
      <span class="contra-issue">${escHtml(c.issue)}</span>
    </div>`).join('');
  document.getElementById('contradiction-panel').classList.remove('hidden');
}

function renderMemo(memoText, question, jurisdiction, sources) {
  const el = document.getElementById('memo-content');
  const legend = sources?.length
    ? `<div class="memo-sources-legend"><strong>Sources Referenced:</strong><ol>${
        sources.map(s => `<li><a href="${escHtml(s.url)}" target="_blank" rel="noopener">${escHtml(s.title)}</a></li>`).join('')
      }</ol></div>` : '';
  el.innerHTML = `<p><em>Re: ${escHtml(question)} | Jurisdiction: ${escHtml(jurisdiction)}</em></p><hr>` + mdToHtml(memoText) + legend;
  el.dataset.raw = memoText;
  el.dataset.question = question;
  el.dataset.jurisdiction = jurisdiction;
  el.dataset.sources = JSON.stringify(sources || []);
}

// ── Follow-up questions ───────────────────────────────────────────────────────
async function sendFollowup() {
  const input = document.getElementById('followup-input');
  const followup = input.value.trim();
  if (!followup) return;
  const el = document.getElementById('memo-content');
  if (!el.dataset.raw) { showError('Run a research query first.'); return; }

  const btn = document.getElementById('followup-btn');
  btn.textContent = '...'; btn.disabled = true;
  input.disabled = true;

  const thread = document.getElementById('followup-thread');
  thread.innerHTML += `<div class="followup-q">${escHtml(followup)}</div>
    <div class="followup-a" id="followup-loading">⏳ Thinking...</div>`;
  thread.scrollTop = thread.scrollHeight;
  input.value = '';

  try {
    let answer;
    if (_backendAvailable) {
      const res = await fetch(`${BACKEND}/api/followup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: el.dataset.question,
          memo: el.dataset.raw,
          followup,
          jurisdiction: el.dataset.jurisdiction,
          api_key: getConfig().apiKey,
        }),
      });
      const data = await res.json();
      answer = data.answer;
    } else {
      const cfg = getConfig();
      answer = await callLLM([{ role: 'user', content:
        `Legal research assistant. Answer this follow-up based on the memo context.
Original question: ${el.dataset.question}
Memo: ${el.dataset.raw.slice(0, 2000)}
Follow-up: ${followup}` }], cfg);
    }
    document.getElementById('followup-loading').id = '';
    document.getElementById('followup-thread').lastElementChild.innerHTML = mdToHtml(answer);
  } catch (e) {
    document.getElementById('followup-loading').textContent = `Error: ${e.message}`;
  } finally {
    btn.textContent = 'Ask'; btn.disabled = false;
    input.disabled = false; input.focus();
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && document.activeElement?.id === 'followup-input') sendFollowup();
});

// ── Plain English ─────────────────────────────────────────────────────────────
async function showPlainEnglish() {
  const el = document.getElementById('memo-content');
  const btn = document.getElementById('plain-btn');
  const panel = document.getElementById('plain-english-panel');
  const content = document.getElementById('plain-content');
  if (!el.dataset.raw) { showError('Run a research query first.'); return; }
  if (!panel.classList.contains('hidden')) { panel.classList.add('hidden'); return; }
  btn.textContent = '⏳ Simplifying...'; btn.disabled = true;
  content.innerHTML = '<p style="color:var(--muted)">Generating plain English summary…</p>';
  panel.classList.remove('hidden');
  try {
    if (_backendAvailable) {
      const res = await fetch(`${BACKEND}/api/plain-english`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memo: el.dataset.raw, question: el.dataset.question, api_key: getConfig().apiKey }),
      });
      content.innerHTML = `<p>${escHtml((await res.json()).summary)}</p>`;
    } else {
      const cfg = getConfig();
      const text = await callLLM([{ role: 'user', content:
        `Rewrite this legal memo in plain English for a non-lawyer. Under 300 words. Start with a one-sentence direct answer. No jargon.
Question: ${el.dataset.question}
Memo: ${el.dataset.raw.slice(0, 3000)}` }], cfg);
      content.innerHTML = `<p>${escHtml(text)}</p>`;
    }
  } catch (e) {
    content.innerHTML = `<p class="accuracy-caveat">Failed: ${escHtml(e.message)}</p>`;
  } finally { btn.textContent = '💬 Plain English'; btn.disabled = false; }
}

// ── RAGAS evaluation ─────────────────────────────────────────────────────────
async function runEvaluation() {
  if (!_lastResult) { showError('Run a research query first.'); return; }
  const btn = document.getElementById('eval-btn');
  btn.textContent = '⏳ Evaluating...'; btn.disabled = true;
  try {
    const res = await fetch(`${BACKEND}/api/evaluate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: _lastResult.question, answer: _lastResult.answer, contexts: _lastResult.contexts, api_key: _lastResult.apiKey }),
    });
    renderRagasScores(await res.json());
  } catch (e) { showError(`Evaluation failed: ${e.message}`); }
  finally { btn.textContent = 'Run Evaluation'; btn.disabled = false; }
}

function renderRagasScores(data) {
  if (data.status === 'error') {
    document.getElementById('ragas-scores').innerHTML = `<p class="accuracy-caveat">⚠️ ${escHtml(data.reason || 'Evaluation unavailable')}</p>`;
    return;
  }
  const metrics = [
    { key: 'faithfulness',      label: 'Faithfulness',      desc: 'Answer grounded in retrieved docs?' },
    { key: 'answer_relevancy',  label: 'Answer Relevancy',  desc: 'Answer addresses the question?' },
    { key: 'context_precision', label: 'Context Precision', desc: 'Retrieved chunks are relevant?' },
  ];
  document.getElementById('ragas-scores').innerHTML = `<div class="ragas-grid">${
    metrics.map(m => {
      const score = data[m.key] ?? null;
      const pct = score !== null ? Math.round(score * 100) : 0;
      const tier = pct >= 70 ? 'high' : pct >= 40 ? 'medium' : 'low';
      const color = tier === 'high' ? 'var(--success)' : tier === 'medium' ? 'var(--gold)' : 'var(--error)';
      return `<div class="accuracy-item">
        <div class="acc-label">${m.label}</div>
        <div class="acc-value">${m.desc}</div>
        <div style="font-size:1.2rem;font-weight:700;color:${color}">${score !== null ? score.toFixed(3) : 'N/A'}</div>
        <div class="acc-bar-wrap"><div class="acc-bar ${tier}" style="width:${pct}%"></div></div>
      </div>`;
    }).join('')
  }</div>${data.reasoning ? `<p style="font-size:0.82rem;color:var(--muted);padding:0 20px 12px">${escHtml(data.reasoning)}</p>` : ''}`;
}

// ── Copy / Download / PDF / Share ────────────────────────────────────────────
function copyMemo() {
  const el = document.getElementById('memo-content');
  const text = `LEGAL RESEARCH MEMO\nRe: ${el.dataset.question}\nJurisdiction: ${el.dataset.jurisdiction}\n\n${el.dataset.raw}`;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.querySelector('.memo-actions .action-btn');
    btn.textContent = '✓ Copied'; setTimeout(() => btn.textContent = '📋 Copy', 2000);
  });
}

function downloadMemo() {
  const el = document.getElementById('memo-content');
  const text = `LEGAL RESEARCH MEMO\nRe: ${el.dataset.question}\nJurisdiction: ${el.dataset.jurisdiction}\n\n${el.dataset.raw}`;
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `legal-memo-${Date.now()}.txt`; a.click();
  URL.revokeObjectURL(url);
}

function exportPDF() {
  const el = document.getElementById('memo-content');
  const printArea = document.getElementById('print-area');
  printArea.innerHTML = `
    <div class="print-header">
      <div class="print-logo">⚖️ LexSynth — Legal Research Memo</div>
      <div class="print-meta">Re: ${escHtml(el.dataset.question)} | Jurisdiction: ${escHtml(el.dataset.jurisdiction)}</div>
    </div>${el.innerHTML}`;
  printArea.classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
  window.print();
  document.getElementById('app').classList.remove('hidden');
  printArea.classList.add('hidden');
}

function shareMemo() {
  const el = document.getElementById('memo-content');
  try {
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify({
      q: el.dataset.question, j: el.dataset.jurisdiction, m: el.dataset.raw, s: el.dataset.sources,
    }))));
    document.getElementById('share-url').value = `${location.href.split('#')[0]}#memo=${encoded}`;
    document.getElementById('share-modal').classList.remove('hidden');
  } catch { showError('Could not generate share link — memo may be too large.'); }
}

function copyShareLink() {
  const input = document.getElementById('share-url');
  navigator.clipboard.writeText(input.value).then(() => {
    const btn = document.getElementById('copy-link-btn');
    btn.textContent = '✓ Copied'; setTimeout(() => btn.textContent = 'Copy', 2000);
  });
}

function closeShareModal(e) {
  if (!e || e.target === document.getElementById('share-modal'))
    document.getElementById('share-modal').classList.add('hidden');
}

function checkSharedMemo() {
  const hash = location.hash;
  if (!hash.startsWith('#memo=')) return;
  try {
    const payload = JSON.parse(decodeURIComponent(escape(atob(hash.slice(6)))));
    const sources = JSON.parse(payload.s || '[]');
    renderSources(sources);
    renderMemo(payload.m, payload.q, payload.j, sources);
    document.getElementById('results-section').classList.remove('hidden');
    document.getElementById('legal-question').value = payload.q || '';
    const banner = document.createElement('div');
    banner.className = 'shared-banner';
    banner.innerHTML = '🔗 You are viewing a shared memo. <button onclick="this.parentElement.remove()">✕</button>';
    document.getElementById('app').insertBefore(banner, document.getElementById('query-section'));
  } catch { }
}

function showError(msg) {
  document.getElementById('error-text').textContent = msg;
  document.getElementById('error-banner').classList.remove('hidden');
}
function dismissError() { document.getElementById('error-banner').classList.add('hidden'); }
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
