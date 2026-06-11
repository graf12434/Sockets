const ADMIN_PASSWORD = 'Otis34#Reb';
const REBOOT_DURATION_MS = 300000; // 5 хвилин

let mqttClient = null;
let sockets = [];

// ── Таймери відліку для кожної розетки ──
const _countdownTimers = {};

function showApp() {
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('app').classList.add('is-visible');
  loadBrokerConfig();
  renderSockets();
  const raw = localStorage.getItem(STORAGE_KEY_BROKER);
  if (!raw) return;
  try { if (JSON.parse(raw).host) setTimeout(mqttConnect, 400); } catch {}
}

function checkAuth() {
  const input = document.getElementById('authInput');
  if (input.value === ADMIN_PASSWORD) { showApp(); return; }
  const err = document.getElementById('authError');
  err.style.display = 'block';
  input.value = '';
  setTimeout(() => { err.style.display = 'none'; }, 2500);
}

window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('admin') === ADMIN_PASSWORD) showApp();
});

function loadBrokerConfig() {
  try {
    const cfg = JSON.parse(localStorage.getItem(STORAGE_KEY_BROKER) || '{}');
    document.getElementById('cfgHost').value = cfg.host || '';
    document.getElementById('cfgPort').value = cfg.port || '8884';
    document.getElementById('cfgUser').value = cfg.user || '';
    document.getElementById('cfgPass').value = cfg.pass || '';
  } catch {}
}

function saveBrokerConfig() {
  localStorage.setItem(STORAGE_KEY_BROKER, JSON.stringify({
    host: document.getElementById('cfgHost').value.trim(),
    port: document.getElementById('cfgPort').value.trim(),
    user: document.getElementById('cfgUser').value.trim(),
    pass: document.getElementById('cfgPass').value.trim()
  }));
}

function publishConfig() {
  if (!mqttClient?.connected) return;
  const cfg = sockets.map(s => ({ id: s.id, name: s.name }));
  mqttClient.publish(TOPIC_CONFIG, JSON.stringify(cfg), { qos: 1, retain: true });
}

function mqttConnect() {
  const host = document.getElementById('cfgHost').value.trim();
  const port = parseInt(document.getElementById('cfgPort').value, 10) || 8884;
  const user = document.getElementById('cfgUser').value.trim();
  const pass = document.getElementById('cfgPass').value.trim();
  if (!host) { alert('Вкажіть адресу брокера'); return; }
  saveBrokerConfig();
  setBrokerStatus('', 'Підключення...');
  if (mqttClient) { try { mqttClient.end(true); } catch {} }
  mqttClient = mqtt.connect(`wss://${host}:${port}/mqtt`, {
    clientId: 'admin_' + Math.random().toString(36).slice(2, 8),
    username: user || undefined,
    password: pass || undefined,
    clean: true,
    reconnectPeriod: 5000
  });
  mqttClient.on('connect', () => {
    setBrokerStatus('connected', host);
    mqttClient.subscribe(TOPIC_CONFIG, { qos: 1 });
    sockets.forEach(s => subscribeSocket(s.id));
  });
  mqttClient.on('error', () => setBrokerStatus('error', 'Помилка'));
  mqttClient.on('offline', () => {
    setBrokerStatus('', 'Офлайн');
    sockets.forEach(s => { s.online = false; });
    renderSockets();
  });
  mqttClient.on('message', (topic, message) => {
    handleMessage(topic, message.toString().trim());
  });
}

function subscribeSocket(id) {
  if (!mqttClient?.connected) return;
  mqttClient.subscribe(`home/${id}/state`, { qos: 1 });
  mqttClient.subscribe(`home/${id}/status`, { qos: 1 });
}

function unsubscribeSocket(id) {
  if (!mqttClient?.connected) return;
  mqttClient.unsubscribe(`home/${id}/state`);
  mqttClient.unsubscribe(`home/${id}/status`);
}

function handleMessage(topic, payload) {
  if (topic === TOPIC_CONFIG) {
    try {
      const list = JSON.parse(payload);
      const prev = {};
      sockets.forEach(s => { prev[s.id] = { state: s.state, online: s.online }; });
      sockets = list.map(item => ({
        id: item.id,
        name: item.name,
        state: prev[item.id]?.state ?? 'ready',   // 'ready' | 'rebooting'
        online: prev[item.id]?.online ?? false,
        _remainMs: prev[item.id]?._remainMs ?? 0
      }));
      sockets.forEach(s => subscribeSocket(s.id));
      renderSockets();
    } catch (e) { console.error(e); }
    return;
  }

  const parts = topic.split('/');
  if (parts.length < 3) return;
  const socket = sockets.find(s => s.id === parts[1]);
  if (!socket) return;

  if (parts[2] === 'state') {
    _applyState(socket, payload);
    updateCard(socket);
    return;
  }
  if (parts[2] === 'status') {
    socket.online = payload === 'online';
    updateCard(socket);
  }
}

// Розбираємо payload: "READY" або "REBOOTING:залишилось_мс"
function _applyState(socket, payload) {
  if (payload === 'READY') {
    socket.state = 'ready';
    socket._remainMs = 0;
    _stopCountdown(socket.id);
  } else if (payload.startsWith('REBOOTING:')) {
    const remain = parseInt(payload.split(':')[1], 10);
    socket.state = 'rebooting';
    socket._remainMs = isNaN(remain) ? REBOOT_DURATION_MS : remain;
    _startCountdown(socket);
  }
}

function _startCountdown(socket) {
  _stopCountdown(socket.id);
  const endTime = Date.now() + socket._remainMs;
  _countdownTimers[socket.id] = setInterval(() => {
    const left = endTime - Date.now();
    if (left <= 0) {
      _stopCountdown(socket.id);
      socket.state = 'ready';
      socket._remainMs = 0;
      updateCard(socket);
      return;
    }
    socket._remainMs = left;
    _updateCountdownLabel(socket.id, left);
  }, 1000);
}

function _stopCountdown(id) {
  if (_countdownTimers[id]) {
    clearInterval(_countdownTimers[id]);
    delete _countdownTimers[id];
  }
}

function _updateCountdownLabel(id, remainMs) {
  const card = document.querySelector(`[data-id="${id}"]`);
  if (!card) return;
  const label = card.querySelector('.reboot-countdown');
  if (label) label.textContent = _formatTime(remainMs);
}

function _formatTime(ms) {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function setBrokerStatus(cls, text) {
  const el = document.getElementById('brokerStatus');
  el.className = 'broker-status' + (cls ? ' ' + cls : '');
  document.getElementById('brokerLabel').textContent = text;
}

function updateCard(socket) {
  const card = document.querySelector(`[data-id="${socket.id}"]`);
  if (!card) return;

  const statusDot   = card.querySelector('.status-dot');
  const statusLabel = card.querySelector('.status-label');
  const btn         = card.querySelector('.reboot-btn');
  const countdown   = card.querySelector('.reboot-countdown');
  const status = socket.online ? 'online' : 'offline';

  statusDot.className   = 'status-dot ' + status;
  statusLabel.className = 'status-label ' + status;
  statusLabel.textContent = status;

  const isRebooting = socket.state === 'rebooting';
  card.classList.toggle('rebooting', isRebooting);

  if (btn) {
    btn.disabled = isRebooting || !socket.online;
    btn.textContent = isRebooting ? 'Перезавантаження...' : 'Перезавантажити';
  }
  if (countdown) {
    countdown.style.display = isRebooting ? 'block' : 'none';
    if (isRebooting) countdown.textContent = _formatTime(socket._remainMs);
  }
}

function renderSockets() {
  const grid = document.getElementById('socketsGrid');
  if (!sockets.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔌</div>
        <div class="empty-title">Розеток ще немає</div>
        <div class="empty-sub">Натисніть "Додати розетку", щоб почати</div>
      </div>`;
    return;
  }

  grid.innerHTML = sockets.map((socket, index) => {
    const isRebooting = socket.state === 'rebooting';
    const status = socket.online ? 'online' : 'offline';
    return `
    <div class="socket-card ${isRebooting ? 'rebooting' : ''}" data-id="${escapeHtml(socket.id)}">
      <div class="card-header">
        <div class="card-name-wrap">
          ${socketStatusMarkup(socket)}
          <div class="card-name is-editable" onclick="startRename(${index})" id="name-${escapeHtml(socket.id)}">
            <span>${escapeHtml(socket.name)}</span><span class="edit-icon">✎</span>
          </div>
          <div class="card-topic">home/${escapeHtml(socket.id)}/command</div>
        </div>
        <button class="btn-delete" onclick="deleteSocket(${index})" title="Видалити">×</button>
      </div>
      <div class="reboot-wrap">
        <div class="reboot-countdown" style="display:${isRebooting ? 'block' : 'none'}">
          ${isRebooting ? _formatTime(socket._remainMs) : ''}
        </div>
        <button class="reboot-btn"
          onclick="rebootSocket(${index})"
          ${isRebooting || !socket.online ? 'disabled' : ''}>
          ${isRebooting ? 'Перезавантаження...' : 'Перезавантажити'}
        </button>
      </div>
    </div>`;
  }).join('');

  // Відновлюємо таймери для тих що вже перезавантажуються
  sockets.forEach(s => {
    if (s.state === 'rebooting' && s._remainMs > 0 && !_countdownTimers[s.id]) {
      _startCountdown(s);
    }
  });
}

function rebootSocket(index) {
  const socket = sockets[index];
  if (!socket?.online || socket.state === 'rebooting') return;
  if (!mqttClient?.connected) { alert('MQTT не підключено'); return; }
  mqttClient.publish(`home/${socket.id}/command`, 'REBOOT', { qos: 1 });
  // Оптимістично встановлюємо стан — підтвердження прийде через state topic
  socket.state = 'rebooting';
  socket._remainMs = REBOOT_DURATION_MS;
  _startCountdown(socket);
  updateCard(socket);
}

function deleteSocket(index) {
  const socket = sockets[index];
  if (!confirm(`Видалити розетку "${socket.name}"?`)) return;
  _stopCountdown(socket.id);
  unsubscribeSocket(socket.id);
  sockets.splice(index, 1);
  publishConfig();
  renderSockets();
}

function startRename(index) {
  const socket = sockets[index];
  const el = document.getElementById(`name-${socket.id}`);
  if (!el) return;
  el.innerHTML = `<input type="text" value="${escapeHtml(socket.name)}" maxlength="32"
    onblur="finishRename(${index}, this.value)"
    onkeydown="if(event.key==='Enter')this.blur();if(event.key==='Escape')this.blur();">`;
  const input = el.querySelector('input');
  input.focus();
  input.select();
}

function finishRename(index, val) {
  const name = val.trim();
  if (name) sockets[index].name = name;
  publishConfig();
  renderSockets();
}

function openModal() {
  document.getElementById('newName').value = '';
  document.getElementById('newDeviceId').value = '';
  document.getElementById('modalOverlay').classList.add('open');
  setTimeout(() => document.getElementById('newName').focus(), 200);
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
}

function addSocket() {
  const name = document.getElementById('newName').value.trim();
  const id   = document.getElementById('newDeviceId').value.trim();
  if (!name) { alert('Введіть назву'); return; }
  if (!id)   { alert('Введіть Device ID'); return; }
  if (!/^[a-zA-Z0-9_]+$/.test(id)) { alert('Device ID: лише латиниця, цифри та _'); return; }
  if (sockets.find(s => s.id === id)) { alert('Такий Device ID вже є'); return; }
  sockets.push({ id, name, state: 'ready', online: false, _remainMs: 0 });
  subscribeSocket(id);
  publishConfig();
  renderSockets();
  closeModal();
}

document.getElementById('modalOverlay').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});
