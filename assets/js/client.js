const REBOOT_DURATION_MS = 300000; // 5 хвилин

let mqttClient = null;
let sockets = [];

const _countdownTimers = {};

function getBrokerConfig() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('host')) {
    return {
      host: params.get('host'),
      port: parseInt(params.get('port'), 10) || 8884,
      user: params.get('user') || '',
      pass: params.get('pass') || ''
    };
  }
  try {
    const cfg = JSON.parse(localStorage.getItem(STORAGE_KEY_BROKER) || '{}');
    return { host: cfg.host || '', port: parseInt(cfg.port, 10) || 8884, user: cfg.user || '', pass: cfg.pass || '' };
  } catch { return null; }
}

function mqttConnect() {
  const cfg = getBrokerConfig();
  if (!cfg?.host) {
    setConnStatus('error', 'Немає конфігурації');
    document.getElementById('loadingState').innerHTML = `<div class="empty-icon">⚙</div><p>Зверніться до адміністратора</p>`;
    return;
  }
  setConnStatus('', 'Підключення...');
  mqttClient = mqtt.connect(`wss://${cfg.host}:${cfg.port}/mqtt`, {
    clientId: 'user_' + Math.random().toString(36).slice(2, 8),
    username: cfg.user || undefined,
    password: cfg.pass || undefined,
    clean: true,
    reconnectPeriod: 5000
  });
  mqttClient.on('connect', () => {
    setConnStatus('connected', 'Підключено');
    mqttClient.subscribe(TOPIC_CONFIG, { qos: 1 });
  });
  mqttClient.on('error', () => setConnStatus('error', 'Помилка'));
  mqttClient.on('offline', () => {
    setConnStatus('', 'Офлайн');
    sockets.forEach(s => { s.online = false; });
    renderSockets();
  });
  mqttClient.on('message', (topic, message) => {
    handleMessage(topic, message.toString().trim());
  });
}

function handleMessage(topic, payload) {
  if (topic === TOPIC_CONFIG) {
    try {
      const list = JSON.parse(payload);
      const prev = {};
      sockets.forEach(s => { prev[s.id] = { state: s.state, online: s.online, _remainMs: s._remainMs }; });
      sockets = list.map(item => ({
        id: item.id,
        name: item.name,
        state: prev[item.id]?.state ?? 'ready',
        online: prev[item.id]?.online ?? false,
        _remainMs: prev[item.id]?._remainMs ?? 0
      }));
      sockets.forEach(s => {
        mqttClient.subscribe(`home/${s.id}/state`, { qos: 1 });
        mqttClient.subscribe(`home/${s.id}/status`, { qos: 1 });
      });
      document.getElementById('loadingState').style.display = 'none';
      document.getElementById('socketsGrid').hidden = false;
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
        <div class="empty-title">Розеток немає</div>
        <div class="empty-sub">Адмін ще не додав жодної розетки</div>
      </div>`;
    return;
  }

  grid.innerHTML = sockets.map((socket, index) => {
    const isRebooting = socket.state === 'rebooting';
    return `
    <div class="socket-card ${isRebooting ? 'rebooting' : ''}" data-id="${escapeHtml(socket.id)}">
      ${socketStatusMarkup(socket)}
      <div class="card-name"><span>${escapeHtml(socket.name)}</span></div>
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

  sockets.forEach(s => {
    if (s.state === 'rebooting' && s._remainMs > 0 && !_countdownTimers[s.id]) {
      _startCountdown(s);
    }
  });
}

function rebootSocket(index) {
  const socket = sockets[index];
  if (!socket?.online || socket.state === 'rebooting') return;
  if (!mqttClient?.connected) return;
  mqttClient.publish(`home/${socket.id}/command`, 'REBOOT', { qos: 1 });
  socket.state = 'rebooting';
  socket._remainMs = REBOOT_DURATION_MS;
  _startCountdown(socket);
  updateCard(socket);
}

function setConnStatus(cls, text) {
  document.getElementById('connStatus').className = 'conn-status' + (cls ? ' ' + cls : '');
  document.getElementById('connLabel').textContent = text;
}

mqttConnect();
