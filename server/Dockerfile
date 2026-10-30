# Pulse API server image.
FROM node:20-alpine

WORKDIR /app

# Install deps first for better layer caching.
COPY package*.json ./
RUN npm install

# App source.
COPY tsconfig.json ./
COPY src ./src

EXPOSE 4000

# ts-node runs TypeScript directly — no build step needed for dev.
CMD ["npm", "run", "dev"]
