# excalidraw-selfhosted

Build do [Excalidraw oficial](https://github.com/excalidraw/excalidraw) apontando para a infra self-hosted da BlueDiamond (room + storage).

A imagem final é publicada em `ghcr.io/bluediam0nd/excalidraw`.

## Como atualizar

Vá em **Actions → Build & Push Excalidraw → Run workflow**, informe a `ref` desejada do repo oficial (`master`, `v0.18.0`, etc.) e dispare. Em alguns minutos a imagem nova está disponível e basta `docker service update --image ghcr.io/bluediam0nd/excalidraw:latest excalidraw_excalidraw` na VPS.

## URLs embutidas no build

- Room (Socket.IO): `https://excalidraw-room.agenciabluediamond.com`
- Storage backend: `https://excalidraw-storage.agenciabluediamond.com`

Para mudar, edite `env` no `.github/workflows/build.yml`.
