# Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json .
COPY pnpm-lock.yaml .
RUN npm install -g pnpm && pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY package*.json .
RUN npm install -g pnpm && pnpm install --prod
EXPOSE 3000
CMD ["node", "dist/src/app.js"]
