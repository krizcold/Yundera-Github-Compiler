FROM node:24-alpine

# Install git and docker CLI (with compose plugin)
RUN apk add --no-cache git docker-cli-compose

WORKDIR /app

# Copy and install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source & build
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# Grant socket access and start
COPY start.sh ./
RUN chmod +x start.sh

CMD ["./start.sh"]
