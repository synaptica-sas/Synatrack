# Build stage
FROM node:24-slim AS base

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build Vite application
RUN npm run build

# Production runner image
FROM node:24-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4173

# Copy built app from base stage
COPY --from=base /app/dist ./dist
COPY server.mjs ./
COPY package*.json ./

EXPOSE 4173

# Start command
CMD ["node", "server.mjs"]
