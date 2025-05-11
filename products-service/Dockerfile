FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --legacy-peer-deps --no-package-lock

# Copy source code
COPY . .

# Start the application
CMD ["node", "server.js"]