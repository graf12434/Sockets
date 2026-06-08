const TOPIC_CONFIG = 'home/config/sockets';
const STORAGE_KEY_BROKER = 'smart_broker_v1';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function socketStatusMarkup(socket) {
  const status = socket.online ? 'online' : 'offline';
  return `
    <div class="device-status">
      <div class="status-dot ${status}"></div>
      <span class="status-label ${status}">${status}</span>
    </div>`;
}

function setCopyrightYear() {
  const yearEl = document.getElementById('copyrightYear');
  if (yearEl) yearEl.textContent = new Date().getFullYear();
}

document.addEventListener('DOMContentLoaded', setCopyrightYear);
