# Build oficial do Excalidraw (excalidraw/excalidraw) com URLs apontando
# para nossa infra self-hosted (room + storage).
#
# Args:
#   EXCALIDRAW_REF      → branch, tag ou commit do repo oficial (default: master)
#   WS_SERVER_URL       → URL do excalidraw-room
#   BACKEND_V2_URL      → URL base do storage (sem trailing slash)

ARG EXCALIDRAW_REF=master

FROM node:20-alpine AS builder
ARG EXCALIDRAW_REF
ARG WS_SERVER_URL
ARG BACKEND_V2_URL

RUN apk add --no-cache git python3 make g++ \
 && git clone --depth 1 --branch ${EXCALIDRAW_REF} https://github.com/excalidraw/excalidraw.git /src \
 || (git clone https://github.com/excalidraw/excalidraw.git /src && cd /src && git checkout ${EXCALIDRAW_REF})

WORKDIR /src

# Sobrescreve .env.production com nossas URLs antes do build do Vite.
# As envs VITE_APP_* são congeladas no bundle final.
RUN printf '%s\n' \
  "VITE_APP_BACKEND_V2_GET_URL=${BACKEND_V2_URL}/api/v2/scenes/" \
  "VITE_APP_BACKEND_V2_POST_URL=${BACKEND_V2_URL}/api/v2/scenes/" \
  "VITE_APP_WS_SERVER_URL=${WS_SERVER_URL}" \
  "VITE_APP_HTTP_STORAGE_BACKEND_URL=${BACKEND_V2_URL}/api/v2" \
  "VITE_APP_STORAGE_BACKEND=http" \
  "VITE_APP_FIREBASE_CONFIG={}" \
  "VITE_APP_DISABLE_TRACKING=true" \
  "VITE_APP_DISABLE_SENTRY=true" \
  "VITE_APP_PLUS_LP=" \
  "VITE_APP_PLUS_APP=" \
  "VITE_APP_AI_BACKEND=" \
  > excalidraw-app/.env.production

RUN yarn install --frozen-lockfile --network-timeout 600000 \
 && yarn build:app:docker

FROM nginx:alpine
COPY --from=builder /src/excalidraw-app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
