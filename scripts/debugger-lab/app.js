const state = {
  hookCalls: 0,
  events: 0,
  requests: 0,
  storageWrites: 0,
  mode: 'idle',
  lastAction: 'none',
  lastResult: 'pending',
  websocketMessages: 0,
};

const refs = {
  hooks: document.querySelector('#metric-hooks'),
  events: document.querySelector('#metric-events'),
  requests: document.querySelector('#metric-requests'),
  storage: document.querySelector('#metric-storage'),
  mode: document.querySelector('#status-mode'),
  lastAction: document.querySelector('#status-last-action'),
  lastResult: document.querySelector('#status-last-result'),
  console: document.querySelector('#console-log'),
  keyword: document.querySelector('#keyword'),
  payload: document.querySelector('#payload'),
  username: document.querySelector('#username'),
  modeSelect: document.querySelector('#mode'),
  form: document.querySelector('#lab-form'),
};

const pushLog = (label, payload) => {
  const time = new Date().toLocaleTimeString('zh-CN', {hour12: false});
  const block = document.createElement('pre');
  const text =
    payload === undefined
      ? `[${time}] ${label}`
      : `[${time}] ${label}\n${JSON.stringify(payload, null, 2)}`;
  block.textContent = text;
  refs.console.prepend(block);
  if (refs.console.children.length > 18) {
    refs.console.lastElementChild?.remove();
  }
  console.log(`[DebuggerLab] ${label}`, payload ?? '');
};

const updateStatus = (patch = {}) => {
  Object.assign(state, patch);
  refs.hooks.textContent = String(state.hookCalls);
  refs.events.textContent = String(state.events);
  refs.requests.textContent = String(state.requests);
  refs.storage.textContent = String(state.storageWrites);
  refs.mode.textContent = state.mode;
  refs.lastAction.textContent = state.lastAction;
  refs.lastResult.textContent = state.lastResult;
};

const safeJsonParse = value => {
  try {
    return JSON.parse(value);
  } catch {
    return {raw: value, invalidJson: true};
  }
};

const complexProfile = {
  id: 'profile-lab-001',
  flags: ['observe-first', 'hook-preferred', 'evidence-first'],
  nested: {
    token: 'token-watch',
    thresholds: {warn: 0.63, critical: 0.91},
    collectors: ['xhr', 'fetch', 'storage'],
  },
};

const signature = {
  createSignature(input) {
    const source = JSON.stringify(input);
    let hash = 0;
    for (let index = 0; index < source.length; index += 1) {
      hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
    }
    return `sig_${hash.toString(16).padStart(8, '0')}`;
  },
  encryptPayload(payloadText) {
    updateStatus({
      hookCalls: state.hookCalls + 1,
      mode: 'encrypting',
      lastAction: 'encryptPayload',
    });
    const parsedPayload = safeJsonParse(payloadText);
    const body = JSON.stringify(parsedPayload);
    const signatureValue = signature.createSignature(parsedPayload);
    const encodedBody = btoa(unescape(encodeURIComponent(body)));
    const bundle = {
      signature: signatureValue,
      encodedBody,
      preview: encodedBody.slice(0, 16),
    };
    window.debugLab.lastEncodedBundle = bundle;
    window.debugLab.runtimeSnapshot.lastEncryptAt = new Date().toISOString();
    updateStatus({lastResult: bundle.signature});
    pushLog('encryptPayload', bundle);
    return bundle;
  },
  async signPayload(payloadText) {
    updateStatus({
      hookCalls: state.hookCalls + 1,
      mode: 'signing',
      lastAction: 'signPayload',
    });
    const parsedPayload = safeJsonParse(payloadText);
    const wait = 160 + Math.floor(Math.random() * 40);
    await new Promise(resolve => window.setTimeout(resolve, wait));
    const result = {
      nonce: `nonce_${Date.now()}`,
      sign: signature.createSignature(parsedPayload),
      length: JSON.stringify(parsedPayload).length,
    };
    window.debugLab.lastSignatureResult = result;
    window.debugLab.runtimeSnapshot.lastSignAt = new Date().toISOString();
    updateStatus({lastResult: result.sign, mode: 'signed'});
    pushLog('signPayload', result);
    return result;
  },
};

const scoring = {
  calculateRiskScore(signal) {
    updateStatus({
      hookCalls: state.hookCalls + 1,
      mode: 'scoring',
      lastAction: 'calculateRiskScore',
    });
    const text = `${signal.keyword}:${signal.mode}:${signal.user}`;
    const score = [...text].reduce(
      (total, char, index) => total + char.charCodeAt(0) * (index + 3),
      17,
    );
    const normalized = Number(((score % 1000) / 1000).toFixed(3));
    const verdict = normalized > 0.72 ? 'review' : 'allow';
    const result = {normalized, verdict};
    window.debugLab.runtimeSnapshot.lastRisk = result;
    updateStatus({lastResult: `${verdict}:${normalized}`});
    pushLog('calculateRiskScore', result);
    return result;
  },
};

const storageOps = {
  persistState() {
    updateStatus({
      storageWrites: state.storageWrites + 1,
      mode: 'storage',
      lastAction: 'persistState',
    });
    const payload = {
      savedAt: new Date().toISOString(),
      username: refs.username.value,
      keyword: refs.keyword.value,
      payload: safeJsonParse(refs.payload.value),
    };
    localStorage.setItem('debugger-lab:profile', JSON.stringify(payload));
    sessionStorage.setItem(
      'debugger-lab:last-action',
      JSON.stringify({
        action: state.lastAction,
        savedAt: payload.savedAt,
      }),
    );
    window.debugLab.runtimeSnapshot.lastStoragePayload = payload;
    updateStatus({lastResult: 'storage-updated'});
    pushLog('persistState', payload);
    return payload;
  },
  refreshCookie() {
    updateStatus({
      storageWrites: state.storageWrites + 1,
      mode: 'cookie',
      lastAction: 'refreshCookie',
    });
    const cookieValue = `dbg_token=${encodeURIComponent(`token-watch-${Date.now()}`)}; path=/; SameSite=Lax`;
    document.cookie = cookieValue;
    updateStatus({lastResult: 'cookie-updated'});
    pushLog('refreshCookie', {cookieValue});
    return cookieValue;
  },
};

const network = {
  async fetchEcho() {
    updateStatus({
      requests: state.requests + 1,
      mode: 'fetch',
      lastAction: 'fetchEcho',
    });
    const response = await fetch(`/api/ping?via=fetch&t=${Date.now()}`, {
      headers: {
        'x-debugger-lab': 'fetch',
      },
    });
    const data = await response.json();
    window.debugLab.lastResponse = {channel: 'fetch', data};
    updateStatus({lastResult: `fetch:${data.message}`});
    pushLog('fetchEcho', data);
    return data;
  },
  xhrEcho() {
    updateStatus({
      requests: state.requests + 1,
      mode: 'xhr',
      lastAction: 'xhrEcho',
    });
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', `/api/ping?via=xhr&t=${Date.now()}`, true);
      xhr.setRequestHeader('x-debugger-lab', 'xhr');
      xhr.onreadystatechange = () => {
        if (xhr.readyState !== 4) {
          return;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          const data = JSON.parse(xhr.responseText);
          window.debugLab.lastResponse = {channel: 'xhr', data};
          updateStatus({lastResult: `xhr:${data.message}`});
          pushLog('xhrEcho', data);
          resolve(data);
          return;
        }
        const error = new Error(`XHR failed with status ${xhr.status}`);
        updateStatus({lastResult: 'xhr-error'});
        reject(error);
      };
      xhr.send();
    });
  },
  async postEcho(payloadText) {
    updateStatus({
      requests: state.requests + 1,
      mode: 'post',
      lastAction: 'postEcho',
    });
    const response = await fetch('/api/echo', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-debugger-lab': 'post',
      },
      body: payloadText,
    });
    const data = await response.json();
    window.debugLab.lastResponse = {channel: 'post', data};
    updateStatus({lastResult: `post:${data.bodyLength}`});
    pushLog('postEcho', data);
    return data;
  },
};

const bus = new EventTarget();
let socket = null;

const debugLab = {
  version: '1.0.0',
  complexProfile,
  signature,
  scoring,
  storageOps,
  network,
  bus,
  wsState: {
    connected: false,
    lastMessage: null,
  },
  lastResponse: null,
  lastEncodedBundle: null,
  lastSignatureResult: null,
  runtimeSnapshot: {
    bootAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    routeName: 'debugger-lab',
  },
  emitSyntheticEvent(detail) {
    updateStatus({
      events: state.events + 1,
      mode: 'event',
      lastAction: 'emitSyntheticEvent',
      lastResult: detail.type,
    });
    const event = new CustomEvent('lab:custom', {detail});
    bus.dispatchEvent(event);
    pushLog('emitSyntheticEvent', detail);
    return detail;
  },
  triggerManualPause() {
    updateStatus({
      hookCalls: state.hookCalls + 1,
      mode: 'paused',
      lastAction: 'triggerManualPause',
    });
    const payload = safeJsonParse(refs.payload.value);
    const attempts = 2;
    const localSecret = 'pause-secret-42';
    const computedToken = signature.createSignature(payload);
    window.debugLab.runtimeSnapshot.lastPausePreview = {
      localSecret,
      attempts,
      computedToken,
    };
    pushLog('triggerManualPause', {localSecret, attempts, computedToken});
    debugger;
    const result = {localSecret, attempts, computedToken};
    updateStatus({lastResult: computedToken, mode: 'resumed'});
    return result;
  },
  connectWebSocket() {
    if (socket && socket.readyState === WebSocket.OPEN) {
      pushLog('connectWebSocket skipped', {reason: 'already-open'});
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

    socket.addEventListener('open', () => {
      debugLab.wsState.connected = true;
      updateStatus({
        lastAction: 'connectWebSocket',
        lastResult: 'ws-open',
        mode: 'websocket',
      });
      pushLog('websocket open', {url: socket.url});
    });

    socket.addEventListener('message', event => {
      state.websocketMessages += 1;
      debugLab.wsState.lastMessage = event.data;
      updateStatus({
        lastAction: 'websocket message',
        lastResult: `ws:${state.websocketMessages}`,
        mode: 'websocket',
      });
      pushLog('websocket message', {data: event.data});
    });

    socket.addEventListener('close', () => {
      debugLab.wsState.connected = false;
      pushLog('websocket closed');
    });
  },
  sendWebSocketMessage() {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      pushLog('sendWebSocketMessage skipped', {reason: 'socket-not-open'});
      return;
    }

    const payload = JSON.stringify({
      type: 'probe',
      keyword: refs.keyword.value,
      at: new Date().toISOString(),
    });
    socket.send(payload);
    updateStatus({
      lastAction: 'sendWebSocketMessage',
      lastResult: 'ws-sent',
      mode: 'websocket',
    });
    pushLog('sendWebSocketMessage', {payload});
  },
};

window.debugLab = debugLab;

bus.addEventListener('lab:custom', event => {
  pushLog('lab:custom event received', event.detail);
});

const submitScenario = event => {
  event.preventDefault();
  updateStatus({
    events: state.events + 1,
    mode: 'submit',
    lastAction: 'form submit',
  });
  const signal = {
    keyword: refs.keyword.value,
    mode: refs.modeSelect.value,
    user: refs.username.value,
  };
  const score = debugLab.scoring.calculateRiskScore(signal);
  updateStatus({lastResult: score.verdict});
};

refs.form.addEventListener('submit', submitScenario);

['click', 'input', 'change'].forEach(type => {
  document.addEventListener(
    type,
    event => {
      state.events += 1;
      refs.events.textContent = String(state.events);
      pushLog(`dom:${type}`, {
        target: event.target?.id || event.target?.tagName || 'unknown',
      });
    },
    true,
  );
});

document.querySelector('#btn-encrypt')?.addEventListener('click', () => {
  debugLab.signature.encryptPayload(refs.payload.value);
});

document.querySelector('#btn-sign')?.addEventListener('click', async () => {
  await debugLab.signature.signPayload(refs.payload.value);
});

document.querySelector('#btn-risk')?.addEventListener('click', () => {
  debugLab.scoring.calculateRiskScore({
    keyword: refs.keyword.value,
    mode: refs.modeSelect.value,
    user: refs.username.value,
  });
});

document.querySelector('#btn-fetch')?.addEventListener('click', async () => {
  await debugLab.network.fetchEcho();
});

document.querySelector('#btn-xhr')?.addEventListener('click', async () => {
  await debugLab.network.xhrEcho();
});

document.querySelector('#btn-post')?.addEventListener('click', async () => {
  await debugLab.network.postEcho(refs.payload.value);
});

document.querySelector('#btn-storage')?.addEventListener('click', () => {
  debugLab.storageOps.persistState();
});

document.querySelector('#btn-cookie')?.addEventListener('click', () => {
  debugLab.storageOps.refreshCookie();
});

document.querySelector('#btn-emit')?.addEventListener('click', () => {
  debugLab.emitSyntheticEvent({
    type: 'lab:manual',
    keyword: refs.keyword.value,
    mode: refs.modeSelect.value,
  });
});

document.querySelector('#btn-submit')?.addEventListener('click', () => {
  refs.form.requestSubmit();
});

document.querySelector('#btn-break')?.addEventListener('click', () => {
  debugLab.triggerManualPause();
});

document.querySelector('#btn-ws-connect')?.addEventListener('click', () => {
  debugLab.connectWebSocket();
});

document.querySelector('#btn-ws-send')?.addEventListener('click', () => {
  debugLab.sendWebSocketMessage();
});

document.querySelector('#btn-inspect')?.addEventListener('click', () => {
  debugLab.runtimeSnapshot.lastInspectTarget = {
    profile: debugLab.complexProfile,
    response: debugLab.lastResponse,
    wsState: debugLab.wsState,
    storageKeys: Object.keys(localStorage),
  };
  updateStatus({
    lastAction: 'updateInspectTarget',
    lastResult: 'inspect-ready',
    mode: 'inspect',
  });
  pushLog('updateInspectTarget', debugLab.runtimeSnapshot.lastInspectTarget);
});

document.querySelector('#btn-real-submit')?.addEventListener('click', () => {
  pushLog('native submit requested');
});

storageOps.persistState();
storageOps.refreshCookie();
pushLog('Debugger Lab ready', {
  tips: [
    'hook window.debugLab.signature.encryptPayload',
    'inspect window.debugLab.runtimeSnapshot',
    'set breakpoint on text debugger;',
  ],
});
updateStatus({lastResult: 'ready'});
