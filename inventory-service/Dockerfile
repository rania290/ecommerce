FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --legacy-peer-deps --no-package-lock

# Copy source code
COPY . .

# Copy proto files from the mounted volume
RUN mkdir -p /protos
COPY ../protos/ ./protos/

# Start the application
CMD ["node", "server.js"]