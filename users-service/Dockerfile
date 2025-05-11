FROM node:18-alpine

WORKDIR /app

# Install dependencies first for better caching
COPY package*.json ./

# Install dependencies including devDependencies for development
RUN npm install

# Copy application code
COPY . .

# Expose the port the app runs on
EXPOSE 3002

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3002

# Command to run the application
CMD ["npm", "start"]
