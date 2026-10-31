export type OfflineJob = { id: string; title: string; company: string; description?: string; location?: string; source_url?: string; apply_url?: string; required_skills?: string[]; required_certifications?: string[]; remote?: boolean; is_demo?: boolean; salary_min?: number | null; salary_max?: number | null; currency?: string };
export type OfflineIntent = { id: string; accountId: string; jobId: string; title: string; createdAt: string };
export const offlineDbName = 'cyberapply-offline-v1';

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(offlineDbName, 1);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      db.createObjectStore('saved', { keyPath: 'accountId' });
      const intents = db.createObjectStore('intents', { keyPath: 'id' });
      intents.createIndex('accountId', 'accountId');
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(new Error('Offline storage is unavailable on this browser.'));
  });
}

export async function offlineTransaction<T>(storeName: 'saved' | 'intents', mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = run(transaction.objectStore(storeName));
    let result: T;
    request.onsuccess = () => { result = request.result; };
    transaction.oncomplete = () => { db.close(); resolve(result); };
    transaction.onerror = () => { db.close(); reject(new Error('Offline storage could not be updated.')); };
    transaction.onabort = transaction.onerror;
  });
}

export async function saveOfflineJobs(accountId: string, jobs: any[]) {
  if (sessionStorage.getItem('cyberapply-offline-account') !== accountId) return;
  const fields: (keyof OfflineJob)[] = ['id', 'title', 'company', 'description', 'location', 'source_url', 'apply_url', 'required_skills', 'required_certifications', 'remote', 'is_demo', 'salary_min', 'salary_max', 'currency'];
  const publicJobs = jobs.map(job => Object.fromEntries(fields.filter(field => job[field] !== undefined).map(field => [field, job[field]])));
  await offlineTransaction('saved', 'readwrite', store => sessionStorage.getItem('cyberapply-offline-account') === accountId ? store.put({ accountId, jobs: publicJobs, savedAt: new Date().toISOString() }) : store.get(accountId));
}
export async function offlineIntents(accountId: string): Promise<OfflineIntent[]> {
  return offlineTransaction('intents', 'readonly', store => store.index('accountId').getAll(accountId));
}
export async function removeOfflineIntent(id: string) { await offlineTransaction('intents', 'readwrite', store => store.delete(id)); }
export async function clearOfflineAccount(accountId: string) {
  const intents = await offlineIntents(accountId);
  for (const intent of intents) await removeOfflineIntent(intent.id);
  await offlineTransaction('saved', 'readwrite', store => store.delete(accountId));
}
