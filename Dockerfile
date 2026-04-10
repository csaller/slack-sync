FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY src/ ./src/
RUN bun build src/index.ts --target bun --outfile dist/index.js

FROM oven/bun:1-slim
WORKDIR /app
COPY --from=builder /app/dist/index.js ./dist/index.js
VOLUME /app/.data
CMD ["bun", "run", "dist/index.js", "--config", "/app/config.yaml"]
