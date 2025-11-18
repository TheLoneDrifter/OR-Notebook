// app.js - Theme broadcast + offline "autocomplete on Tab" and settings helpers.
// Extended: cross-tab note messaging & note share handling helper.
//
// Responsibilities:
//  - Apply saved theme on load and update the <meta name="theme-color">.
//  - Listen for theme changes via BroadcastChannel and service-worker messages and apply them live.
//  - Offer a small API for the settings page to set theme and broadcast changes.
//  - Provide BroadcastChannel + SW fallback for note messages (create/update/delete/move).
//  - Keep the offline autocomplete-on-Tab implementation for the editor.
//  - Expose helper methods for sharing notes.

const THEME_KEY = 'or_theme';
const AUTOKEY = 'or_autocomplete_tab';
const BC_THEME_NAME = 'or-theme';
const BC_NOTES_NAME = 'or-notes';

// ---------- Theme handling & cross-window live updates ----------
function updateThemeMetaForMode(mode) {
  const themeColorMeta = document.getElementById('themeColorMeta');
  if (!themeColorMeta) return;
  if (mode === 'dark') { themeColorMeta.setAttribute('content', '#0f151a'); }
  else { themeColorMeta.setAttribute('content', '#ffffff'); }
}
function applyThemeValue(t) {
  let mode = t;
  if (!t) t = localStorage.getItem(THEME_KEY) || 'system';
  if (t === 'system') { mode = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
  document.body.classList.remove('light', 'dark');
  document.body.classList.add(mode);
  updateThemeMetaForMode(mode);
}

function broadcastThemeChange(themeValue) {
  try {
    if ('BroadcastChannel' in self) {
      const bc = new BroadcastChannel(BC_THEME_NAME);
      bc.postMessage({ type: 'theme-change', theme: themeValue });
      bc.close();
    }
  } catch (e) { }
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    try { navigator.serviceWorker.controller.postMessage({ type: 'theme-change', theme: themeValue }); } catch (e) { }
  }
  try { localStorage.setItem(THEME_KEY, themeValue); } catch (e) { }
}

function setupThemeListeners() {
  if ('BroadcastChannel' in self) {
    try {
      const bc = new BroadcastChannel(BC_THEME_NAME);
      bc.onmessage = (ev) => {
        const d = ev.data || {};
        if (d && d.type === 'theme-change') applyThemeValue(d.theme);
      };
    } catch (e) { }
  }
  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener && navigator.serviceWorker.addEventListener('message', (ev) => {
      const d = ev.data || {};
      if (d && d.type === 'theme-change') applyThemeValue(d.theme);
    });
  }
  window.addEventListener('storage', (e) => {
    if (e.key === THEME_KEY && e.newValue) {
      applyThemeValue(e.newValue);
    }
  });
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (ev) => {
      const cur = localStorage.getItem(THEME_KEY) || 'system';
      if (cur === 'system') applyThemeValue('system');
    });
  }
}
function getThemeSetting() { return localStorage.getItem(THEME_KEY) || 'system'; }
function setThemeSetting(v) {
  localStorage.setItem(THEME_KEY, v);
  applyThemeValue(v);
  broadcastThemeChange(v);
}

// ---------- Notes cross-tab messaging ----------
function setupNotesBroadcasting() {
  // Listen via BroadcastChannel if available
  if ('BroadcastChannel' in self) {
    try {
      const bc = new BroadcastChannel(BC_NOTES_NAME);
      bc.onmessage = (ev) => {
        const d = ev.data || {};
        // normalize and dispatch as custom event for the app
        if (d && d.type && d.type.startsWith('note-')) {
          window.dispatchEvent(new CustomEvent('or:noteMessage', { detail: d }));
        }
      };
    } catch (e) { }
  }

  // Listen to service-worker forwarded messages
  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener && navigator.serviceWorker.addEventListener('message', (ev) => {
      const d = ev.data || {};
      if (d && d.type && d.type.startsWith('note-')) {
        window.dispatchEvent(new CustomEvent('or:noteMessage', { detail: d }));
      }
    });
  }

  // Storage fallback for tabs that don't get BroadcastChannel: uses a timestamped key to indicate updates
  window.addEventListener('storage', (e) => {
    // We'll store a serialized payload in or_notes_update_payload for fallback (stringified)
    if (e.key === 'or_notes_update_payload' && e.newValue) {
      try {
        const d = JSON.parse(e.newValue);
        if (d && d.type && d.type.startsWith('note-')) {
          window.dispatchEvent(new CustomEvent('or:noteMessage', { detail: d }));
        }
      } catch (e) { }
    }
  });
}

function sendNoteMessage(action, payload) {
  const type = 'note-' + action; // 'note-updated', 'note-created', 'note-deleted', 'note-moved'
  const message = { type, payload, ts: Date.now() };

  // BroadcastChannel
  try {
    if ('BroadcastChannel' in self) {
      const bc = new BroadcastChannel(BC_NOTES_NAME);
      bc.postMessage(message);
      bc.close();
    }
  } catch (e) { }

  // Service worker fallback
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    try { navigator.serviceWorker.controller.postMessage(message); } catch (e) { }
  }

  // localStorage fallback for other tabs
  try {
    localStorage.setItem('or_notes_update_payload', JSON.stringify(message));
    // also maintain an update timestamp in case size-limited storages trim payload
    localStorage.setItem('or_notes_update_ts', String(Date.now()));
  } catch (e) { }
}

// ---------- Autocomplete-on-Tab (offline) ----------
function isAutocompleteEnabled() {
  const v = localStorage.getItem(AUTOKEY);
  if (v === null) return true;
  return v !== 'false';
}
function setAutocompleteEnabled(enabled) {
  localStorage.setItem(AUTOKEY, enabled ? 'true' : 'false');
  try { window.dispatchEvent(new CustomEvent('or:autocompleteChanged', { detail: { enabled } })); } catch (e) { }
}

/* Build dictionary from notes */
function buildDictionarySync() {
  const raw = localStorage.getItem('or_notes');
  let map = {};
  try { map = raw ? JSON.parse(raw) : {}; } catch (e) { map = {}; }
  const set = new Set();
  Object.values(map).flat().forEach(arr => {
    (arr || []).forEach(n => {
      if (!n) return;
      const text = (n.title || '') + ' ' + (n.text || '');
      const words = text.match(/[A-Za-z0-9_\-]{3,}/g);
      if (words) words.forEach(w => set.add(w));
    });
  });
  return set;
}

/* Find completion for prefix */
function findCompletion(prefix, dictSet) {
  if (!prefix || prefix.length < 1) return null;
  const pref = prefix;
  const candidates = [];
  dictSet.forEach(w => {
    if (w.length <= pref.length) return;
    if (w.startsWith(pref)) candidates.push(w);
  });
  if (candidates.length === 0) {
    const lower = pref.toLowerCase();
    dictSet.forEach(w => {
      if (w.length <= pref.length) return;
      if (w.toLowerCase().startsWith(lower)) candidates.push(w);
    });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (a.length - b.length) || a.localeCompare(b));
  return candidates[0];
}

function replaceRangeInInput(el, start, end, text, newSelectionOffset = 0) {
  const val = el.value;
  const before = val.slice(0, start);
  const after = val.slice(end);
  el.value = before + text + after;
  const caret = before.length + text.length + newSelectionOffset;
  el.setSelectionRange(caret, caret);
  el.focus();
}

function attachAutocompleteToTextarea(textarea) {
  if (!textarea) return;
  let dict = buildDictionarySync();

  window.addEventListener('storage', (e) => {
    if (e.key === 'or_notes') dict = buildDictionarySync();
  });

  window.addEventListener('or:notesChanged', () => dict = buildDictionarySync());
  window.addEventListener('or:autocompleteChanged', () => {/* no-op */ });

  const refreshDictFromCurrent = () => {
    const currWords = (textarea.value || '').match(/[A-Za-z0-9_\-]{3,}/g) || [];
    currWords.forEach(w => dict.add(w));
  };

  textarea.addEventListener('input', refreshDictFromCurrent);

  textarea.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Tab') return;
    const enabled = isAutocompleteEnabled();
    if (!enabled) return;
    ev.preventDefault();

    const ta = textarea;
    const pos = ta.selectionStart;
    const val = ta.value;
    const left = val.slice(0, pos);
    const match = left.match(/([A-Za-z0-9_\-]{1,})$/);
    const prefix = match ? match[1] : '';

    if (!prefix) {
      replaceRangeInInput(ta, pos, pos, '\t', 0);
      return;
    }

    const completion = findCompletion(prefix, dict);
    if (completion) {
      replaceRangeInInput(ta, pos - prefix.length, pos, completion, 0);
      return;
    }
    replaceRangeInInput(ta, pos, pos, '\t', 0);
  });
}

// ---------- Sharing helpers ----------
async function shareNoteData(note) {
  const title = note.title || 'Untitled';
  const text = (note.text || '');
  const payloadText = `# ${title}\n\n${text}`;

  // Try Web Share API
  if (navigator.share) {
    try {
      await navigator.share({ title, text: payloadText });
      return { ok: true, method: 'share' };
    } catch (e) {
      // share failed or user cancelled, fallthrough to clipboard
    }
  }

  // Try copy to clipboard
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(payloadText);
      return { ok: true, method: 'clipboard' };
    } catch (e) {
      // fallthrough to download
    }
  }

  // Fallback: create downloadable blob
  try {
    const blob = new Blob([payloadText], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeTitle = (title || 'note').replace(/[^\w\-]+/g, '_').slice(0, 60) || 'note';
    a.download = safeTitle + '.md';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return { ok: true, method: 'download' };
  } catch (e) {
    return { ok: false, error: e && e.message };
  }
}

// ---------- Initialization ----------
document.addEventListener('DOMContentLoaded', () => {
  applyThemeValue(getThemeSetting());
  setupThemeListeners();
  setupNotesBroadcasting();

  const noteTA = document.getElementById('noteBody');
  if (noteTA) attachAutocompleteToTextarea(noteTA);
});

// ---------- Expose API ----------
window.ORApp = {
  getThemeSetting,
  setThemeSetting,
  isAutocompleteEnabled,
  setAutocompleteEnabled,
  buildDictionarySync,
  findCompletion,
  sendNoteMessage,
  shareNoteData
};