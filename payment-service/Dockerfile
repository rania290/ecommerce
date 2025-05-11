# Stage 1: Build dependencies
FROM node:18-alpine AS dependencies
WORKDIR /app
COPY package*.json ./

# Configure npm
RUN npm config set registry https://registry.npmjs.org && \
    npm config set strict-ssl false && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    npm config set maxsockets 100 && \
    npm install --legacy-peer-deps

# Stage 2: Production
FROM node:18-alpine
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

# Configure npm
RUN npm config set registry https://registry.npmjs.org && \
    npm config set strict-ssl false && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    npm config set maxsockets 100 && \
    npm install --only=production

EXPOSE 3007 50052
CMD ["npm", "start"]
