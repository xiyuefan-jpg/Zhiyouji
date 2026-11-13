# The server (API + worker in one process, PRD part 2 §2). The website and the
# admin console are static files (npm run build -w …) served by nginx / OSS.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
# workspaces: manifests first so the install layer is cached
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY tools/sim/package.json tools/sim/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
RUN npm ci --include=dev --ignore-scripts
COPY packages packages
COPY apps/server apps/server
EXPOSE 3000
# migrations run on start (packages/db createPgDb); stop with SIGTERM
CMD ["npx", "tsx", "apps/server/src/main.ts"]
