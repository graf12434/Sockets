let mqttClient = null;
let sockets = [];

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
    return {
      host: cfg.host || '',
      port: parseInt(cfg.port, 10) || 8884,
      user: cfg.user || '',
      pass: cfg.pass || ''
    };
  } catch {
    return null;
  }
}

function mqttConnect() {
  const cfg = getBrokerConfig();
  if (!cfg?.host) {
    setConnStatus('error', 'Немає конфігурації');
    document.getElementById('loadingState').innerHTML = `
      <div class="empty-icon">⚙</div>
      <p>Зверніться до адміністратора</p>`;
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
    sockets.forEach(socket => { socket.online = false; });
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
      sockets.forEach(socket => {
        prev[socket.id] = { relay: socket.relay, online: socket.online };
      });
      sockets = list.map(item => ({
        id: item.id,
        name: item.name,
        relay: prev[item.id]?.relay ?? false,
        online: prev[item.id]?.online ?? false
      }));
      sockets.forEach(socket => {
        mqttClient.subscribe(`home/${socket.id}/state`, { qos: 1 });
        mqttClient.subscribe(`home/${socket.id}/status`, { qos: 1 });
      });
      document.getElementById('loadingState').style.display = 'none';
      document.getElementById('socketsGrid').hidden = false;
      renderSockets();
    } catch (error) {
      console.error(error);
    }
    return;
  }

  const parts = topic.split('/');
  if (parts.length < 3) return;

  const socket = sockets.find(item => item.id === parts[1]);
  if (!socket) return;

  if (parts[2] === 'state') {
    socket.relay = payload === 'ON';
    updateCard(socket);
    return;
  }

  if (parts[2] === 'status') {
    socket.online = payload === 'online';
    updateCard(socket);
  }
}

function updateCard(socket) {
  const card = document.querySelector(`[data-id="${socket.id}"]`);
  if (!card) return;

  const relayState = card.querySelector('.relay-state');
  const toggle = card.querySelector('.toggle-btn');
  const statusDot = card.querySelector('.status-dot');
  const statusLabel = card.querySelector('.status-label');
  const status = socket.online ? 'online' : 'offline';

  card.classList.toggle('on', socket.relay);
  relayState.className = 'relay-state' + (socket.relay ? ' on' : '');
  relayState.textContent = socket.relay ? 'ON' : 'OFF';
  toggle.className = 'toggle-btn' + (socket.relay ? ' on' : '') + (!socket.online ? ' disabled' : '');
  statusDot.className = 'status-dot ' + status;
  statusLabel.className = 'status-label ' + status;
  statusLabel.textContent = status;
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

  grid.innerHTML = sockets.map((socket, index) => `
    <div class="socket-card ${socket.relay ? 'on' : ''}" data-id="${escapeHtml(socket.id)}">
      ${socketStatusMarkup(socket)}
      <div class="card-name"><span>${escapeHtml(socket.name)}</span></div>
      <div class="toggle-wrap">
        <div class="relay-state ${socket.relay ? 'on' : ''}">${socket.relay ? 'ON' : 'OFF'}</div>
        <button class="toggle-btn ${socket.relay ? 'on' : ''} ${!socket.online ? 'disabled' : ''}"
          onclick="toggleSocket(${index})" aria-label="Перемкнути ${escapeHtml(socket.name)}"></button>
      </div>
    </div>`).join('');
}

function toggleSocket(index) {
  const socket = sockets[index];
  if (!socket?.online || !mqttClient?.connected) return;
  mqttClient.publish(`home/${socket.id}/command`, socket.relay ? 'OFF' : 'ON', { qos: 1 });
  socket.relay = !socket.relay;
  renderSockets();
}

function setConnStatus(cls, text) {
  document.getElementById('connStatus').className = 'conn-status' + (cls ? ' ' + cls : '');
  document.getElementById('connLabel').textContent = text;
}

mqttConnect();
