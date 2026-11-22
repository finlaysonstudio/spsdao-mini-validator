# Minimal SPS validator: computes L2 block hashes in memory and performs validator duties; no database, no web UI.
#
# Node 24 must run with --no-use-std-math-pow: V8's default std::pow is 1 ulp off upstream's
# node:23.3 (0.99 ** 32 is ...534 instead of ...535), and upstream feeds such floats into hashed
# events. The flag is rejected in NODE_OPTIONS; BlockProcessor refuses to start without it.
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
CMD ["node", "--no-use-std-math-pow", "--max-old-space-size=3072", "packages/validator/dist/main.mjs"]
