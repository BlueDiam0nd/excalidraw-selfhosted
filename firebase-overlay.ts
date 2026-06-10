// firebase-overlay.ts
// Substitui excalidraw-app/data/firebase.ts em build-time pra evitar
// dependência do Firebase em deploy 100% self-hosted.
// Live colab continua via WebSocket (excalidraw-room) e share-link continua
// salvando o snapshot inicial no excalidraw-storage. O que se perde é a
// persistência periódica da sala via Firebase.

export const isSavedToFirebase = (_portal: any, _elements: any): boolean => true;

export const saveFilesToFirebase = async ({ files }: { prefix: string; files: any[] }) => {
  return { savedFiles: files.map((f: any) => f.id), erroredFiles: [] as any[] };
};

export const saveToFirebase = async (
  _portal: any,
  _elements: any,
  _appState: any,
): Promise<any> => null;

export const loadFromFirebase = async (
  _roomId: string,
  _roomKey: string,
  _socket: any,
): Promise<any> => null;

export const loadFilesFromFirebase = async (
  _prefix: string,
  _decryptionKey: string,
  _filesIds: any,
): Promise<{ loadedFiles: any[]; erroredFiles: Map<any, true> }> => ({
  loadedFiles: [],
  erroredFiles: new Map(),
});

// Retorna objeto fake tipado como `any` pra satisfazer callsites que ainda
// chamam `ref(storage, ...)` em runtime (ex: ExportToExcalidrawPlus). Mesmo
// assim, em runtime essas chamadas falham — mas o user self-hosted não usa
// Export to Excalidraw+ (produto pago externo).
export const loadFirebaseStorage = async (): Promise<any> =>
  ({ _selfHostedNoop: true } as any);
