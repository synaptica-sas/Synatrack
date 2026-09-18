# Base image
FROM node:24-slim AS base

# Install openssl for Prisma
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma client and build typescript
RUN npm run build

# Production runtime image
FROM node:24-slim AS runner

# Install openssl for Prisma in runner image too
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

# Copy package files and prisma for potential runtime migrations
COPY package*.json ./
COPY prisma ./prisma

# Install production dependencies only
RUN npm ci --only=production

# Copy built app from base stage
COPY --from=base /app/dist ./dist

EXPOSE 4000

# Start command
CMD ["npm", "run", "start"]
