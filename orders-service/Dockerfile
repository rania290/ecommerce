FROM node:18-alpine

WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install --legacy-peer-deps

# Copy the rest of the application
COPY . .

# Expose the port the app runs on
EXPOSE 3006 50051

# Command to run the application
CMD ["npm", "start"]
