FROM node:22.14.0-alpine AS build
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build

FROM node:22.14.0-alpine AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/ui/package.json apps/ui/package.json
COPY packages/domain/package.json packages/domain/package.json
RUN npm ci --omit=dev --ignore-scripts

FROM node:22.14.0-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/ui/dist ./apps/ui/dist
COPY --from=build /app/packages/domain/dist ./packages/domain/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/packages/domain/package.json ./packages/domain/package.json
COPY --from=build /app/migrations ./migrations
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/server.js"]
