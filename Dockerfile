# Minimal SPS validator observer: computes L2 block hashes in memory, no database, no web UI.
#
# The Node version must match upstream's (apps/sps-validator/Dockerfile: node:23.3-alpine3.20):
# V8's Math.pow / ** differs between releases in the last ulp (0.99 ** 32 is ...535 on 23.3 and
# ...534 on 26), and upstream feeds such floats straight into hashed events.
FROM node:23.3-alpine3.20 AS dev
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/validator/package.json packages/validator/
RUN npm ci --workspace packages/validator --include-workspace-root --ignore-scripts
COPY packages/validator packages/validator
RUN npm run build --workspace packages/validator

FROM dev AS build
RUN npm prune --omit=dev --workspace packages/validator --include-workspace-root

FROM node:23.3-alpine3.20
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/validator/dist ./packages/validator/dist
COPY --from=build /app/packages/validator/package.json ./packages/validator/package.json
USER node
CMD ["node", "--max-old-space-size=3072", "packages/validator/dist/main.mjs"]
