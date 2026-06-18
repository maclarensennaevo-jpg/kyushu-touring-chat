'use strict';

let currentStep = 1;
const TOTAL_STEPS = 6;

const conditions = {
  departure: '',
  destination: [],
  duration: '',
  themes: [],
  distance: '',
  companions: ''
};

const stepMeta = {
  1: { key: 'departure', multi: false },
  2: { key: 'destination', multi: true },
  3: { key: 'duration', multi: false },
  4: { key: 'themes', multi: true },
  5: { key: 'distance', multi: false },
  6: { key: 'companions', multi: false }
};

let history = [];
let busy = false;

// ─── Init ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  bindWizardButtons();
  autoResize(document.getElementById('user-input'));
  document.getElementById('user-input').addEventListener('input', syncSendBtn);
  document.getElementById('other-area-text').addEventListener('input', syncDestination);
});

function bindWizardButtons() {
  for (let s = 1; s <= TOTAL_STEPS; s++) {
    const meta = stepMeta[s];
    const stepEl = document.getElementById(`step-${s}`);
    stepEl.querySelectorAll('.option-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (meta.multi) onMultiClick(btn, s);
        else onSingleClick(btn, s);
      });
    });
  }
}

// ─── Wizard step logic ───────────────────────────────────
function onSingleClick(btn, stepNum) {
  const stepEl = document.getElementById(`step-${stepNum}`);
  stepEl.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  conditions[stepMeta[stepNum].key] = btn.dataset.value;
  setTimeout(() => nextStep(), 280);
}

function onMultiClick(btn, stepNum) {
  btn.classList.toggle('selected');

  if (btn.dataset.value === '__other__' && stepNum === 2) {
    const wrap = document.getElementById('other-area-wrap');
    if (btn.classList.contains('selected')) {
      wrap.classList.remove('hidden');
      document.getElementById('other-area-text').focus();
    } else {
      wrap.classList.add('hidden');
      document.getElementById('other-area-text').value = '';
    }
  }

  syncDestination();

  const nextBtn = document.getElementById(`step${stepNum}-next`);
  if (nextBtn) nextBtn.disabled = conditions[stepMeta[stepNum].key].length === 0;
}

function syncDestination() {
  const stepEl = document.getElementById('step-2');
  const vals = [...stepEl.querySelectorAll('.option-btn.selected')].flatMap(b => {
    if (b.dataset.value === '__other__') {
      const txt = document.getElementById('other-area-text').value.trim();
      return txt ? [txt] : [];
    }
    return [b.dataset.value];
  });
  conditions.destination = vals;
}

function nextStep() {
  if (currentStep < TOTAL_STEPS) {
    completeStep(currentStep);
    currentStep++;
    activateStep(currentStep);
  } else {
    launchChat();
  }
}

function prevStep() {
  if (currentStep > 1) {
    currentStep--;
    activateStep(currentStep);
    // Re-mark previous as active (not completed)
    const dot = document.querySelector(`.step[data-step="${currentStep}"]`);
    dot.classList.remove('completed');
    dot.classList.add('active');
    dot.querySelector('.step-circle').textContent = currentStep;
  }
}

function completeStep(n) {
  const dot = document.querySelector(`.step[data-step="${n}"]`);
  dot.classList.remove('active');
  dot.classList.add('completed');
  dot.querySelector('.step-circle').textContent = '✓';
}

function activateStep(n) {
  document.querySelectorAll('.wizard-step').forEach(el => el.classList.remove('active'));
  document.getElementById(`step-${n}`).classList.add('active');

  document.querySelectorAll('.step').forEach(dot => {
    const dn = parseInt(dot.dataset.step);
    dot.classList.toggle('active', dn === n);
  });
}

// ─── Chat launch ─────────────────────────────────────────
async function launchChat() {
  document.getElementById('wizard-section').classList.add('hidden');
  document.getElementById('chat-section').classList.remove('hidden');
  renderSummary();

  const initMsg = buildInitialPrompt();
  addMessage('user', 'この条件でツーリングプランを提案してください！');
  history.push({ role: 'user', content: initMsg });
  await callAPI();
}

function buildInitialPrompt() {
  const dest = conditions.destination.length ? conditions.destination.join('、') : '特に指定なし（おすすめに任せる）';
  const themes = conditions.themes.length ? conditions.themes.join('、') : '特に指定なし';
  return [
    '九州ツーリングのプランを提案してください。',
    '',
    `■ 出発地：${conditions.departure}`,
    `■ 行きたいエリア：${dest}`,
    `■ 日程：${conditions.duration}`,
    `■ テーマ：${themes}`,
    `■ 距離感：${conditions.distance}`,
    `■ 同行人数：${conditions.companions}`,
    '',
    'まず以下の形式で回答してください。',
    '- ルート名',
    '- おすすめスポット3箇所（各スポットの簡単な説明）',
    '- 総所要時間の目安'
  ].join('\n');
}

function renderSummary() {
  const dest = conditions.destination.length ? conditions.destination.join(' / ') : '指定なし';
  const themes = conditions.themes.length ? conditions.themes.join(' / ') : '指定なし';
  document.getElementById('conditions-summary').innerHTML = `
    <h3>選択した条件</h3>
    <div class="conditions-tags">
      <span class="tag">🏍️ ${conditions.departure}発</span>
      <span class="tag">📍 ${dest}</span>
      <span class="tag">📅 ${conditions.duration}</span>
      <span class="tag">🎯 ${themes}</span>
      <span class="tag">📏 ${conditions.distance}</span>
      <span class="tag">👥 ${conditions.companions}</span>
    </div>`;
}

// ─── Chat send ────────────────────────────────────────────
async function sendMessage() {
  const input = document.getElementById('user-input');
  const text = input.value.trim();
  if (!text || busy) return;
  input.value = '';
  input.style.height = 'auto';
  syncSendBtn();
  addMessage('user', text);
  history.push({ role: 'user', content: text });
  await callAPI();
}

async function callAPI() {
  busy = true;
  syncSendBtn();
  const typingId = showTyping();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history, conditions })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    history.push({ role: 'assistant', content: data.reply });
    removeTyping(typingId);
    addMessage('ai', data.reply);
  } catch (err) {
    removeTyping(typingId);
    addMessage('ai', `⚠️ エラーが発生しました。\n\`${err.message}\`\n\nもう一度試してください。`);
    history.pop();
  } finally {
    busy = false;
    syncSendBtn();
  }
}

// ─── Message rendering ────────────────────────────────────
function addMessage(role, text) {
  const el = document.createElement('div');
  el.className = `message ${role}`;
  el.innerHTML = `
    <div class="avatar">${role === 'ai' ? '🏍️' : '👤'}</div>
    <div class="bubble">${role === 'ai' ? md(text) : esc(text)}</div>`;
  const box = document.getElementById('chat-messages');
  box.appendChild(el);
  if (role === 'ai') {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    box.scrollTop = box.scrollHeight;
  }
}

function showTyping() {
  const id = 'typing-' + Date.now();
  const el = document.createElement('div');
  el.id = id;
  el.className = 'message ai typing-indicator';
  el.innerHTML = `
    <div class="avatar">🏍️</div>
    <div class="bubble"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>`;
  const box = document.getElementById('chat-messages');
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  return id;
}

function removeTyping(id) {
  document.getElementById(id)?.remove();
}

// ─── Markdown (minimal) ──────────────────────────────────
function md(raw) {
  const s = esc(raw);
  return s
    .replace(/^#{1,3}\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>')
    .replace(/^(\d+)\.\s+(.+)$/gm, '<li>$2</li>')
    .replace(/(<li>[\s\S]*?<\/li>)(\n<li>[\s\S]*?<\/li>)*/g, m => `<ul>${m}</ul>`)
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');
}

function esc(t) {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Utilities ────────────────────────────────────────────
function handleKeyDown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

function syncSendBtn() {
  const btn = document.getElementById('send-btn');
  const val = document.getElementById('user-input').value.trim();
  btn.disabled = busy || !val;
}

function autoResize(ta) {
  ta.addEventListener('input', () => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 110) + 'px';
  });
}

function restartWizard() {
  // Reset state
  currentStep = 1;
  Object.assign(conditions, { departure: '', destination: [], duration: '', themes: [], distance: '', companions: '' });
  history = [];

  // Reset step indicators
  document.querySelectorAll('.step').forEach(dot => {
    const n = dot.dataset.step;
    dot.classList.remove('active', 'completed');
    dot.querySelector('.step-circle').textContent = n;
  });
  document.querySelector('.step[data-step="1"]').classList.add('active');

  // Reset wizard UI
  document.querySelectorAll('.wizard-step').forEach(el => el.classList.remove('active'));
  document.getElementById('step-1').classList.add('active');
  document.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
  const step4Next = document.getElementById('step4-next');
  if (step4Next) step4Next.disabled = true;

  // Reset chat
  document.getElementById('chat-messages').innerHTML = '';

  // Switch views
  document.getElementById('chat-section').classList.add('hidden');
  document.getElementById('wizard-section').classList.remove('hidden');
}
