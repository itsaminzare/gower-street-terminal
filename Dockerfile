# Gower Street Terminal — container for Hugging Face Spaces (or any Docker host)
# Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
FROM node:24-slim

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
# Writable folder for history/alerts; Spaces run the container as UID 1000 (the image's "node" user)
RUN mkdir -p data && chown -R node:node /app
USER node

# Public-site defaults. Secrets (AISSTREAM_API_KEY, ANTHROPIC_API_KEY, NTFY_TOPIC) are set in the Space settings, never here.
ENV HOST=0.0.0.0 \
    PORT=7860 \
    ANALYST_MODEL=claude-haiku-5-5 \
    ANALYST_INTERVAL_MIN=60 \
    ANALYST_DAILY_MAX=30 \
    ANALYST_ALERT_DEBOUNCE_MIN=20 \
    ASK_DAILY_LIMIT=30 \
    ASK_PER_VISITOR_LIMIT=5 \
    MANUAL_RUN_MIN_INTERVAL_MIN=15

EXPOSE 7860
CMD ["node", "server.js"]
