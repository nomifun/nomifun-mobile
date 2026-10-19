import { isInstallationKey } from './device-identity-core';

const DATABASE = 'nomifun.device-identities';
const STORE = 'installations';

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Device identity storage could not be opened'));
  });
}

/** One IndexedDB transaction owns get-or-create across every tab on this origin. */
export function createIndexedDbDeviceIdentityStore(factory: () => IDBFactory | undefined, generate: () => string) {
  return {
    async getInstallationKey(desktopId: string): Promise<string> {
      if (!desktopId) throw new Error('A Desktop identity is required');
      const indexedDB = factory();
      if (!indexedDB) throw new Error('IndexedDB is required to persist device identity');
      const database = await openDatabase(indexedDB);
      try {
        return await new Promise<string>((resolve, reject) => {
          const transaction = database.transaction(STORE, 'readwrite', { durability: 'strict' });
          let identity: string | undefined;
          let failure: unknown;
          transaction.oncomplete = () => identity !== undefined
            ? resolve(identity) : reject(new Error('Device identity transaction completed without an identity'));
          transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Device identity transaction aborted'));
          const store = transaction.objectStore(STORE);
          const request = store.get(desktopId);
          request.onsuccess = () => {
            try {
              if (request.result !== undefined) {
                if (!isInstallationKey(request.result)) throw new Error('Stored device installation identity is invalid');
                identity = request.result;
              } else {
                // Generation must stay synchronous so the transaction cannot auto-commit before add.
                const generated = generate();
                if (!isInstallationKey(generated)) throw new Error('Generated device installation identity is invalid');
                identity = generated;
                store.add(generated, desktopId);
              }
            } catch (error) {
              failure = error;
              transaction.abort();
            }
          };
        });
      } finally {
        database.close();
      }
    },
  };
}
