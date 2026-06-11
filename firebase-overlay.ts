// firebase-overlay.ts
// Substitui excalidraw-app/data/firebase.ts em build-time.
//
// Em vez dos no-ops anteriores (que faziam o room perder tudo quando o último
// cliente saía), agora persiste o estado da sala no nosso excalidraw-storage
// via endpoints HTTP /api/v2/rooms/:id e /api/v2/files/:id. Mantém
// zero-knowledge: o storage só vê bytes encriptados com a roomKey da URL.
//
// Spec: .specs/features/library-autosave/spec.md
// Pin upstream: a83ac488536dbf4bc4dcf1f472f72ce3b4bd2073

import { reconcileElements } from "@excalidraw/excalidraw";
import { MIME_TYPES, toBrandedType } from "@excalidraw/common";
import { decompressData } from "@excalidraw/excalidraw/data/encode";
import {
  encryptData,
  decryptData,
} from "@excalidraw/excalidraw/data/encryption";
import { restoreElements } from "@excalidraw/excalidraw/data/restore";
import { getSceneVersion } from "@excalidraw/element";

import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type {
  ExcalidrawElement,
  FileId,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";
import type {
  AppState,
  BinaryFileData,
  BinaryFileMetadata,
  DataURL,
} from "@excalidraw/excalidraw/types";

import { getSyncableElements } from ".";

import type { SyncableExcalidrawElement } from ".";
import type Portal from "../collab/Portal";
import type { Socket } from "socket.io-client";

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------

const STORAGE_URL: string = (
  import.meta.env.VITE_APP_HTTP_STORAGE_BACKEND_URL || ""
).replace(/\/$/, "");

const roomsEndpoint = (roomId: string) =>
  `${STORAGE_URL}/rooms/${encodeURIComponent(roomId)}`;
const filesEndpoint = (id: FileId) =>
  `${STORAGE_URL}/files/${encodeURIComponent(id)}`;

// -----------------------------------------------------------------------------
// Protocolo binário (evita o JSON body-parser default de 100kb do NestJS;
// raw-parser do storage backend aceita 50mb com qualquer content-type).
// Layout:
//   [4 bytes sceneVersion BE][12 bytes IV][N bytes ciphertext]
// -----------------------------------------------------------------------------

const IV_LEN = 12;
const HEADER_LEN = 4 + IV_LEN;

const packStoredScene = (
  sceneVersion: number,
  iv: Uint8Array,
  ciphertext: Uint8Array,
): Uint8Array => {
  const out = new Uint8Array(HEADER_LEN + ciphertext.length);
  new DataView(out.buffer).setUint32(0, sceneVersion >>> 0, false); // big-endian
  out.set(iv, 4);
  out.set(ciphertext, HEADER_LEN);
  return out;
};

type StoredScene = {
  sceneVersion: number;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: Uint8Array<ArrayBuffer>;
};

const unpackStoredScene = (buf: ArrayBuffer): StoredScene | null => {
  if (buf.byteLength < HEADER_LEN) {
    return null;
  }
  const view = new DataView(buf);
  const sceneVersion = view.getUint32(0, false);
  const iv = new Uint8Array(buf, 4, IV_LEN);
  const ciphertext = new Uint8Array(buf, HEADER_LEN);
  // Copia pra garantir ArrayBuffer (não SharedArrayBuffer) no type system.
  return {
    sceneVersion,
    iv: new Uint8Array(iv) as Uint8Array<ArrayBuffer>,
    ciphertext: new Uint8Array(ciphertext) as Uint8Array<ArrayBuffer>,
  };
};

// -----------------------------------------------------------------------------
// Crypto wrappers (mesmo esquema que o firebase.ts original do upstream)
// -----------------------------------------------------------------------------

const encryptElements = async (
  key: string,
  elements: readonly ExcalidrawElement[],
): Promise<{ ciphertext: ArrayBuffer; iv: Uint8Array<ArrayBuffer> }> => {
  const json = JSON.stringify(elements);
  const encoded = new TextEncoder().encode(json);
  const { encryptedBuffer, iv } = await encryptData(key, encoded);
  return { ciphertext: encryptedBuffer, iv };
};

const decryptElements = async (
  data: StoredScene,
  roomKey: string,
): Promise<readonly ExcalidrawElement[]> => {
  const decrypted = await decryptData(data.iv, data.ciphertext, roomKey);
  const decodedData = new TextDecoder("utf-8").decode(
    new Uint8Array(decrypted),
  );
  return JSON.parse(decodedData);
};

// -----------------------------------------------------------------------------
// Cache de versão (idêntico ao original) — usado por isSavedToFirebase
// -----------------------------------------------------------------------------

class StorageSceneVersionCache {
  private static cache = new WeakMap<Socket, number>();
  static get = (socket: Socket) => StorageSceneVersionCache.cache.get(socket);
  static set = (
    socket: Socket,
    elements: readonly SyncableExcalidrawElement[],
  ) => {
    StorageSceneVersionCache.cache.set(socket, getSceneVersion(elements));
  };
}

export const isSavedToFirebase = (
  portal: Portal,
  elements: readonly ExcalidrawElement[],
): boolean => {
  if (portal.socket && portal.roomId && portal.roomKey) {
    const sceneVersion = getSceneVersion(elements);
    return StorageSceneVersionCache.get(portal.socket) === sceneVersion;
  }
  // sem sala, considera salvo (igual ao upstream — não bloqueia close)
  return true;
};

// -----------------------------------------------------------------------------
// loadFirebaseStorage — fake (chamadas residuais não devem quebrar o app)
// -----------------------------------------------------------------------------

export const loadFirebaseStorage = async (): Promise<any> =>
  ({ _selfHostedNoop: true } as any);

// -----------------------------------------------------------------------------
// saveToFirebase — PUT /api/v2/rooms/:id  (com reconciliação prévia via GET)
// -----------------------------------------------------------------------------

const fetchStoredScene = async (
  roomId: string,
): Promise<StoredScene | null> => {
  try {
    const res = await fetch(roomsEndpoint(roomId), { method: "GET" });
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      console.warn(`[overlay] GET room ${roomId} -> ${res.status}`);
      return null;
    }
    const buf = await res.arrayBuffer();
    const parsed = unpackStoredScene(buf);
    if (!parsed) {
      console.warn(`[overlay] GET room ${roomId} -> payload invalido`);
      return null;
    }
    return parsed;
  } catch (err) {
    console.warn(`[overlay] GET room ${roomId} falhou`, err);
    return null;
  }
};

const putStoredScene = async (
  roomId: string,
  scene: StoredScene,
): Promise<boolean> => {
  try {
    const body = packStoredScene(
      scene.sceneVersion,
      scene.iv,
      scene.ciphertext,
    );
    const res = await fetch(roomsEndpoint(roomId), {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: body.slice().buffer as ArrayBuffer,
    });
    if (!res.ok) {
      console.warn(`[overlay] PUT room ${roomId} -> ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[overlay] PUT room ${roomId} falhou`, err);
    return false;
  }
};

const buildStoredScene = async (
  elements: readonly SyncableExcalidrawElement[],
  roomKey: string,
): Promise<StoredScene> => {
  const sceneVersion = getSceneVersion(elements);
  const { ciphertext, iv } = await encryptElements(roomKey, elements);
  return {
    sceneVersion,
    iv,
    ciphertext: new Uint8Array(ciphertext) as Uint8Array<ArrayBuffer>,
  };
};

export const saveToFirebase = async (
  portal: Portal,
  elements: readonly SyncableExcalidrawElement[],
  appState: AppState,
) => {
  const { roomId, roomKey, socket } = portal;
  if (
    !roomId ||
    !roomKey ||
    !socket ||
    !STORAGE_URL ||
    isSavedToFirebase(portal, elements)
  ) {
    return null;
  }

  // Reconciliacao: o storage HTTP nao tem transacao, entao fazemos GET + merge
  // + PUT. Race entre 2 clientes salvando simultaneamente e mitigada pelo
  // versionNonce dos elementos (reconcileElements escolhe o mais novo).
  const prevStoredScene = await fetchStoredScene(roomId);

  let finalElements: readonly SyncableExcalidrawElement[] = elements;
  if (prevStoredScene) {
    try {
      const prevDecrypted = await decryptElements(prevStoredScene, roomKey);
      const prevSyncable = getSyncableElements(
        restoreElements(prevDecrypted, null),
      );
      finalElements = getSyncableElements(
        reconcileElements(
          elements,
          prevSyncable as OrderedExcalidrawElement[] as RemoteExcalidrawElement[],
          appState,
        ),
      );
    } catch (err) {
      // Decrypt falhou (roomKey errada ou payload corrompido) - sobrescreve.
      console.warn(
        `[overlay] decrypt prev falhou em ${roomId}, sobrescrevendo`,
        err,
      );
    }
  }

  const storedScene = await buildStoredScene(finalElements, roomKey);
  const ok = await putStoredScene(roomId, storedScene);
  if (!ok) {
    return null;
  }

  // Releitura para retornar exatamente o que ficou no servidor (mesma semantica
  // do upstream, que rele do snapshot da transacao).
  const storedElements = getSyncableElements(
    restoreElements(await decryptElements(storedScene, roomKey), null),
  );

  StorageSceneVersionCache.set(socket, storedElements);

  return toBrandedType<RemoteExcalidrawElement[]>(storedElements);
};

// -----------------------------------------------------------------------------
// loadFromFirebase - GET /api/v2/rooms/:id
// -----------------------------------------------------------------------------

export const loadFromFirebase = async (
  roomId: string,
  roomKey: string,
  socket: Socket | null,
): Promise<readonly SyncableExcalidrawElement[] | null> => {
  if (!STORAGE_URL) {
    return null;
  }
  const storedScene = await fetchStoredScene(roomId);
  if (!storedScene) {
    return null;
  }

  let decrypted: readonly ExcalidrawElement[];
  try {
    decrypted = await decryptElements(storedScene, roomKey);
  } catch (err) {
    console.warn(`[overlay] decrypt em load ${roomId} falhou`, err);
    return null;
  }

  const elements = getSyncableElements(
    restoreElements(decrypted, null, { deleteInvisibleElements: true }),
  );

  if (socket) {
    StorageSceneVersionCache.set(socket, elements);
  }

  return elements;
};

// -----------------------------------------------------------------------------
// saveFilesToFirebase - PUT /api/v2/files/:id  (buffer ja vem encriptado+comprimido)
// -----------------------------------------------------------------------------

export const saveFilesToFirebase = async ({
  files,
}: {
  prefix: string;
  files: { id: FileId; buffer: Uint8Array }[];
}) => {
  const erroredFiles: FileId[] = [];
  const savedFiles: FileId[] = [];

  if (!STORAGE_URL) {
    return { savedFiles, erroredFiles: files.map((f) => f.id) };
  }

  await Promise.all(
    files.map(async ({ id, buffer }) => {
      try {
        const res = await fetch(filesEndpoint(id), {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: new Blob([new Uint8Array(buffer)]),
        });
        if (res.ok) {
          savedFiles.push(id);
        } else {
          console.warn(`[overlay] PUT file ${id} -> ${res.status}`);
          erroredFiles.push(id);
        }
      } catch (err) {
        console.warn(`[overlay] PUT file ${id} falhou`, err);
        erroredFiles.push(id);
      }
    }),
  );

  return { savedFiles, erroredFiles };
};

// -----------------------------------------------------------------------------
// loadFilesFromFirebase - GET /api/v2/files/:id (decompressData faz decrypt+gunzip)
// -----------------------------------------------------------------------------

export const loadFilesFromFirebase = async (
  _prefix: string,
  decryptionKey: string,
  filesIds: readonly FileId[],
) => {
  const loadedFiles: BinaryFileData[] = [];
  const erroredFiles = new Map<FileId, true>();

  if (!STORAGE_URL) {
    filesIds.forEach((id) => erroredFiles.set(id, true));
    return { loadedFiles, erroredFiles };
  }

  await Promise.all(
    [...new Set(filesIds)].map(async (id) => {
      try {
        const res = await fetch(filesEndpoint(id), { method: "GET" });
        if (!res.ok) {
          erroredFiles.set(id, true);
          return;
        }
        const arrayBuffer = await res.arrayBuffer();
        const { data, metadata } = await decompressData<BinaryFileMetadata>(
          new Uint8Array(arrayBuffer),
          { decryptionKey },
        );
        const dataURL = new TextDecoder().decode(data) as DataURL;
        loadedFiles.push({
          mimeType: metadata.mimeType || MIME_TYPES.binary,
          id,
          dataURL,
          created: metadata?.created || Date.now(),
          lastRetrieved: metadata?.created || Date.now(),
        });
      } catch (err) {
        erroredFiles.set(id, true);
        console.error(`[overlay] load file ${id} falhou`, err);
      }
    }),
  );

  return { loadedFiles, erroredFiles };
};
