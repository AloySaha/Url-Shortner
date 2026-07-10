FROM dhi.io/node:26-dev AS builder

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci

FROM dhi.io/node:26-alpine AS runtime

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules

COPY . .

ENTRYPOINT ["node", "server.js"]

