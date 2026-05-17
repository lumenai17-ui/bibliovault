# ── BiblioVault AI — Production Dockerfile for Render ──
# Includes LibreOffice headless for DOC/DOCX → PDF conversion

FROM node:20-slim

WORKDIR /app

# Install LibreOffice + fonts for document conversion
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    libreoffice-writer \
    libreoffice-common \
    fonts-liberation \
    fonts-dejavu-core \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copy and install root dependencies (frontend)
COPY package*.json ./
RUN npm ci

# Copy and install server dependencies
COPY server/package*.json ./server/
RUN cd server && npm ci

# Copy all source code
COPY . .

# Build frontend (Vite)
RUN npm run build

# Create data directories
RUN mkdir -p /app/server/data/covers /app/server/data/pdf-cache

# Environment
ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

# Server runs with tsx (TypeScript execution)
CMD ["node", "--max-old-space-size=450", "--import", "tsx/esm", "server/src/index.ts"]
