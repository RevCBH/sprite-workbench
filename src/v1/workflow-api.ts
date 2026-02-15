function makeQuery(params) {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    query.set(key, String(value));
  });
  return query.toString();
}

async function request(baseUrl, method, route, payload = null) {
  const url = `${baseUrl.replace(/\/$/, '')}${route}`;
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const message = data?.error || `Request failed (${response.status})`;
    const error = new Error(message);
    // @ts-ignore - attach parsed server payload for richer UI errors.
    error.data = data;
    throw error;
  }
  return data;
}

export async function getSequenceList(baseUrl, filters = {}) {
  const query = makeQuery(filters);
  const route = `/api/sequences/list${query ? `?${query}` : ''}`;
  return request(baseUrl, 'GET', route);
}

export async function getSequenceNext(baseUrl, filters = {}) {
  const query = makeQuery(filters);
  const route = `/api/sequences/next${query ? `?${query}` : ''}`;
  return request(baseUrl, 'GET', route);
}

export async function preflightSequence(baseUrl, sequenceKey, payload) {
  return request(baseUrl, 'POST', `/api/sequences/${encodeURIComponent(sequenceKey)}/preflight`, payload);
}

export async function saveSequence(baseUrl, sequenceKey, payload) {
  return request(baseUrl, 'POST', `/api/sequences/${encodeURIComponent(sequenceKey)}/save`, payload);
}

export async function fetchSourceClip(baseUrl, relativePath) {
  const base = baseUrl.replace(/\/$/, '');
  const query = makeQuery({ path: relativePath });
  const url = `${base}/api/source-clip${query ? `?${query}` : ''}`;
  const response = await fetch(url, { method: 'GET' });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const data = await response.json();
      message = data?.error || message;
    } catch {
      // ignore json parse failures
    }
    throw new Error(message);
  }
  return response.blob();
}

export async function fetchArtifactText(baseUrl, relativePath) {
  const base = baseUrl.replace(/\/$/, '');
  const query = makeQuery({ path: relativePath });
  const url = `${base}/api/artifact${query ? `?${query}` : ''}`;
  const response = await fetch(url, { method: 'GET' });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const data = await response.json();
      message = data?.error || message;
    } catch {
      // ignore json parse failures
    }
    throw new Error(message);
  }
  return response.text();
}

export async function getQueueList(baseUrl, filters = {}) {
  const query = makeQuery(filters);
  const route = `/api/queue/list${query ? `?${query}` : ''}`;
  return request(baseUrl, 'GET', route);
}

export async function getQueueNext(baseUrl, filters = {}) {
  const query = makeQuery(filters);
  const route = `/api/queue/next${query ? `?${query}` : ''}`;
  return request(baseUrl, 'GET', route);
}

export async function commitRaw(baseUrl, shotKey, payload) {
  return request(baseUrl, 'POST', `/api/shot/${encodeURIComponent(shotKey)}/commit-raw`, payload);
}

export async function commitSelected(baseUrl, shotKey, payload) {
  return request(baseUrl, 'POST', `/api/shot/${encodeURIComponent(shotKey)}/commit-selected`, payload);
}

export async function commitProcessed(baseUrl, shotKey, payload) {
  return request(baseUrl, 'POST', `/api/shot/${encodeURIComponent(shotKey)}/commit-processed`, payload);
}

export async function commitSheet(baseUrl, shotKey, payload) {
  return request(baseUrl, 'POST', `/api/shot/${encodeURIComponent(shotKey)}/commit-sheet`, payload);
}

export async function appendShotNote(baseUrl, shotKey, payload) {
  return request(baseUrl, 'POST', `/api/shot/${encodeURIComponent(shotKey)}/note`, payload);
}

export async function commitShotTiming(baseUrl, shotKey, payload) {
  return request(baseUrl, 'POST', `/api/shot/${encodeURIComponent(shotKey)}/timing`, payload);
}

export async function applyGroupTiming(baseUrl, payload) {
  return request(baseUrl, 'POST', '/api/group/apply-timing', payload);
}

export async function reshapeGroupCycle(baseUrl, payload) {
  return request(baseUrl, 'POST', '/api/group/reshape-cycle', payload);
}

export async function applySheetScope(baseUrl, payload) {
  return request(baseUrl, 'POST', '/api/group/apply-sheet', payload);
}

export async function validateWorkflow(baseUrl) {
  const url = `${baseUrl.replace(/\/$/, '')}/api/validate`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok && !data?.result) {
    const message = data?.error || `Request failed (${response.status})`;
    throw new Error(message);
  }
  return data;
}

export async function healthcheck(baseUrl) {
  return request(baseUrl, 'GET', '/api/health');
}
