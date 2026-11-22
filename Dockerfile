# Minimal SPS validator: computes L2 block hashes in memory and performs validator duties; no database, no web UI.
FROM node:24.22.2-alpine AS dev
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/validator/package.json packages/validator/
RUN npm ci --workspace packages/validator --include-workspace-root --ignore-scripts
COPY packages/validator packages/validator
RUN npm run build --workspace packages/validator

FROM dev AS build
RUN npm prune --omit=dev --workspace packages/validator --include-workspace-root

FROM node:24.22.2-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/validator/dist ./packages/validator/dist
COPY --from=build /app/packages/validator/package.json ./packages/validator/package.json
USER node
CMD ["node", "--max-old-space-size=3072", "packages/validator/dist/main.mjs"]
