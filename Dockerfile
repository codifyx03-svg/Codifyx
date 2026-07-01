# Use official Node.js runtime as a parent image
FROM node:20-slim

# Install build dependencies for native modules (like sqlite3)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy local code to the container image
COPY . .

# Cloud Run binds to the PORT environment variable (default 8080)
EXPOSE 8080

# Run the web service on container startup
CMD ["node", "server.js"]
