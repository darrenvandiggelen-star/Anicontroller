export type CharacterKind = 'vrm' | 'image';

export interface StoredCharacter {
  id: string;
  name: string;
  fileName: string;
  blob: Blob;
  kind?: CharacterKind;
  createdAt: number;
}

const DB_NAME = 'anicontroller-db';
const STORE_NAME = 'characters';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

export async function saveCharacter(name: string, file: File, kind: CharacterKind = 'vrm'): Promise<StoredCharacter> {
  const db = await openDb();
  const item: StoredCharacter = {
    id: crypto.randomUUID(),
    name,
    fileName: file.name,
    blob: file,
    kind,
    createdAt: Date.now(),
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  db.close();
  return item;
}

export async function listCharacters(): Promise<StoredCharacter[]> {
  const db = await openDb();
  const items = await new Promise<StoredCharacter[]>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as StoredCharacter[]);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return items
    .map((item) => ({ ...item, kind: item.kind ?? 'vrm' }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteCharacter(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export function storedCharacterToFile(item: StoredCharacter): File {
  const fallbackType = item.kind === 'image' ? 'image/png' : 'model/gltf-binary';
  return new File([item.blob], item.fileName, { type: item.blob.type || fallbackType });
}
