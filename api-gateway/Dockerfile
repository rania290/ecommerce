FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY api-gateway/package*.json ./

# Install dependencies
RUN npm install --only=production

# Copy source code
COPY api-gateway/ .

# Start the application
CMD ["node", "dist/server.js"]