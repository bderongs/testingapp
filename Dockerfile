# This Dockerfile configures the production environment for Railway deployment.
# It ensures Playwright browsers are installed and the Next.js app can run.

FROM node:20-slim

# Install system dependencies required for Playwright
RUN apt-get update && apt-get install -y \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production=false

# Install Playwright browsers
RUN npx playwright install --with-deps chromium

# Copy application files
COPY . .

# Build the Next.js application
RUN npm run build

# Expose the port Railway will use
EXPOSE 3000

# Start the application
# Use PORT from Railway environment variable, default to 3000
ENV PORT=3000
CMD ["next", "start"]

