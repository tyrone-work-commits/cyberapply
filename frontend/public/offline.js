/* Account-scoped public listing snapshots; DOM content is always text. */
(async () => {
  const accountId = sessionStorage.getItem('cyberapply-offline-account');
  const status = document.getElementById('status');
  const clear = document.getElementById('clear');
  const say = value => { status.textContent = value; };
  if (!accountId) { say('No signed-in account snapshot is available in this tab. Reconnect and sign in to save listings.'); clear.hidden = true; return; }
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('cyberapply-offline-v1', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('saved', { keyPath: 'accountId' }); const intents = request.result.createObjectStore('intents', { keyPath: 'id' }); intents.createIndex('accountId', 'accountId'); };
    request.onsuccess = () => resolve(request.result); request.onerror = reject;
  }).catch(() => null);
  if (!db) { say('Offline storage is unavailable. Return to the app when you reconnect.'); return; }
  function operation(name, mode, run) {
    return new Promise((resolve, reject) => { const transaction = db.transaction(name, mode); const request = run(transaction.objectStore(name)); let result; request.onsuccess = () => { result = request.result; }; transaction.oncomplete = () => resolve(result); transaction.onerror = reject; });
  }
  const snapshot = await operation('saved', 'readonly', store => store.get(accountId));
  const intents = await operation('intents', 'readonly', store => store.index('accountId').getAll(accountId));
  if (!snapshot?.jobs?.length) say('There are no saved listings on this device yet. Save a role while online first.');
  if (snapshot?.savedAt) document.getElementById('snapshot-date').textContent = 'Snapshot saved ' + new Date(snapshot.savedAt).toLocaleString();
  for (const job of snapshot?.jobs || []) {
    const article = document.createElement('article'); article.className = 'job';
    function text(tag, value, className) { const node = document.createElement(tag); node.textContent = value || ''; if (className) node.className = className; article.appendChild(node); return node; }
    text('p', job.company, 'company'); text('h2', job.title); text('p', [job.location, job.remote ? 'Remote' : '', job.is_demo ? 'Demo role' : ''].filter(Boolean).join(' · '), 'meta');
    text('p', job.description, 'description');
    const controls = document.createElement('div'); const button = document.createElement('button'); button.type = 'button';
    const existing = intents.some(intent => intent.jobId === job.id);
    button.textContent = existing ? 'Waiting for connection — review in app' : 'Choose to apply when online'; button.disabled = existing;
    button.onclick = async () => { const intent = { id: 'offline-' + crypto.randomUUID(), accountId, jobId: job.id, title: job.title, createdAt: new Date().toISOString() }; await operation('intents', 'readwrite', store => store.put(intent)); button.textContent = 'Waiting for connection — review in app'; button.disabled = true; say('Choice saved. Reconnect and review it in the app before submission.'); };
    controls.appendChild(button); article.appendChild(controls); document.getElementById('jobs').appendChild(article);
  }
  clear.onclick = async () => { await operation('saved', 'readwrite', store => store.delete(accountId)); const choices = await operation('intents', 'readonly', store => store.index('accountId').getAll(accountId)); for (const choice of choices) await operation('intents', 'readwrite', store => store.delete(choice.id)); document.getElementById('jobs').replaceChildren(); say('Offline listings and pending choices cleared.'); };
  window.addEventListener('online', () => say('Connection restored. Return to the app to sign in and review your pending choices.'));
})().catch(() => { document.getElementById('status').textContent = 'Offline listings could not be loaded. Return to the app when connected.'; });
