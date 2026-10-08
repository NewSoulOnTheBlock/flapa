# P.A.C.S on a server: Bun runs the daemon, Node runs the trade helper and the Claude CLI (the brain).
FROM node:22-bookworm-slim
COPY --from=oven/bun:1.3 /usr/local/bin/bun /usr/local/bin/bun
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* \
 && npm install -g @anthropic-ai/claude-code && npm cache clean --force

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY . .

# State lives on the Render disk mounted at /var/data. The brain is the CLI, signed in by CLAUDE_CODE_OAUTH_TOKEN.
ENV NODE_ENV=production FLAPA_HOME=/var/data/flapa FLAPA_BRAIN=cli
CMD ["bun", "run", "src/main.ts"]
