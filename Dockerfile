FROM node:24-alpine

# Install git, Docker CLI, compose plugin, and curl
RUN apk add --no-cache \
      git \
      docker-cli \
      docker-cli-compose \
      curl

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# Copy the public directory AFTER the build is complete
COPY src/public/ /app/dist/public/

CMD ["node", "dist/index.js"]