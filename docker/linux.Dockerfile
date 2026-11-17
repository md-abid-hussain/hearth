# Builds Hearth for Linux in a container and runs the smoke test on a virtual display. There is
# no camera in here, so this checks installing, building, starting both windows and packaging.
# Run it with: npm run test:linux
FROM node:22-bookworm

# Electron's runtime libraries, a virtual display, and the X11 libraries the talk-key hook links.
RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb xauth \
      libnss3 libatk1.0-0 libatk-bridge2.0-0 libgtk-3-0 libgbm1 libasound2 libdrm2 \
      libxss1 libxtst6 libxt6 libxkbcommon-x11-0 libxcomposite1 libxdamage1 libxrandr2 \
      libcups2 libsecret-1-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run typecheck && npm run lint && npx electron-vite build

# The smoke test passes --no-sandbox on Linux, which Electron needs when running as root.
CMD ["sh", "-c", "xvfb-run -a npm run smoke && npx electron-builder --linux --dir --publish never && ls dist"]
