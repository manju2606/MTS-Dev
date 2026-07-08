(function () {
  document.documentElement.setAttribute('data-theme', localStorage.getItem('mts-ops-theme') || 'light');
})();

function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('mts-ops-theme', next);
  const btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = next === 'dark' ? '☀' : '🌙';
}

window.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '☀' : '🌙';
});

function copyCmd(el) {
  const text = el.firstChild.textContent;
  navigator.clipboard.writeText(text).then(() => {
    el.classList.add('copied');
    setTimeout(() => el.classList.remove('copied'), 1000);
  });
}

const API_BASE = window.location.origin;

async function fetchJSON(path, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs || 5000);
  try {
    const res = await fetch(API_BASE + path, { signal: controller.signal });
    clearTimeout(t);
    return await res.json();
  } catch (e) {
    clearTimeout(t);
    return { status: 'down', error: e.message };
  }
}

function statusDot(status) {
  if (status === 'up') return '<span class="status-dot dot-green"></span>up';
  if (status === 'down') return '<span class="status-dot dot-red"></span>down';
  return '<span class="status-dot dot-grey"></span>checking…';
}

function statusBadge(status) {
  if (status === 'up') return '<span class="badge badge-up">UP</span>';
  if (status === 'down') return '<span class="badge badge-down">DOWN</span>';
  return '<span class="badge badge-warn">?</span>';
}
