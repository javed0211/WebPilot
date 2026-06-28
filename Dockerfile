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

# Python deps for browser-use runner
RUN apt-get update && apt-get install -y python3 python3-pip && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
COPY packages/browser-use ./packages/browser-use
RUN pip3 install --no-cache-dir -r requirements.txt

# Pre-download and setup target browser engines
RUN npx playwright install chromium firefox

# Copy remaining code files
COPY . .

# Run diagnostics checks to confirm compilation
RUN npm run doctor

# Default execution trigger
ENTRYPOINT ["npm", "run", "webpilot", "--"]
CMD ["doctor"]
