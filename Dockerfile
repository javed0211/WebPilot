# ====================================================================
# WebPilot: Production-Grade AI-Native QE Container Config
# ====================================================================
FROM mcr.microsoft.com/playwright:v1.45.0-noble

# Set working context
WORKDIR /workspace

# Copy dependencies manifest
COPY package*.json tsconfig.json ./

# Install packages
RUN npm ci

# Pre-download and setup target browser engines
RUN npx playwright install chromium firefox

# Copy remaining code files
COPY . .

# Run diagnostics checks to confirm compilation
RUN npm run doctor

# Default execution trigger
ENTRYPOINT ["npm", "run", "webpilot", "--"]
CMD ["doctor"]
