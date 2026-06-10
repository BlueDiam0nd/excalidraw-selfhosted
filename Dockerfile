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

# Sobrescreve overrides no .env.production da RAIZ do repo (que é o que o Vite lê).
# As envs VITE_APP_* são congeladas no bundle final.
RUN { \
  echo ""; \
  echo "# overrides BlueDiamond"; \
  echo "VITE_APP_BACKEND_V2_GET_URL=${BACKEND_V2_URL}/api/v2/scenes/"; \
  echo "VITE_APP_BACKEND_V2_POST_URL=${BACKEND_V2_URL}/api/v2/scenes/"; \
  echo "VITE_APP_WS_SERVER_URL=${WS_SERVER_URL}"; \
  echo "VITE_APP_HTTP_STORAGE_BACKEND_URL=${BACKEND_V2_URL}/api/v2"; \
  echo "VITE_APP_STORAGE_BACKEND=http"; \
  echo "VITE_APP_FIREBASE_CONFIG={}"; \
  echo "VITE_APP_DISABLE_TRACKING=true"; \
  echo "VITE_APP_DISABLE_SENTRY=true"; \
  echo "VITE_APP_AI_BACKEND="; \
  echo "VITE_APP_PLUS_LP="; \
  echo "VITE_APP_PLUS_APP="; \
} >> .env.production \
 && echo "===== .env.production final =====" && cat .env.production

# Substitui firebase.ts por overlay NOOP (sem Firebase em prod self-hosted).
COPY firebase-overlay.ts excalidraw-app/data/firebase.ts

RUN yarn install --frozen-lockfile --network-timeout 600000 \
 && yarn build:app:docker

# Injeta hook do library no index.html (resiste a bumps do upstream).
COPY library-hook.js /tmp/library-hook.js
RUN cp /tmp/library-hook.js /src/excalidraw-app/build/__library-hook.js \
 && sed -i 's|</head>|<script src="/__library-hook.js" defer></script></head>|' /src/excalidraw-app/build/index.html

FROM nginx:alpine
COPY --from=builder /src/excalidraw-app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
