FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application code
COPY . .


# Expose the port the app runs on
EXPOSE 3010

# Command to run the application
CMD ["npm", "start"]
