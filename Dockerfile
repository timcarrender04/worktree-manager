FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat git bash
WORKDIR /app

COPY package.json package-lock.json* ./
# Use cache mount for npm cache to speed up dependency installation
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# Development image - run dev server directly
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=development
ENV NEXT_TELEMETRY_DISABLED=1

# Use build arguments for user/group IDs to match host user
# Default to 1020 to match common host user IDs
ARG USER_ID=1020
ARG GROUP_ID=1020
# Cache bust argument - changes on each build to force rebuild
ARG CACHE_BUST=1

# Create group and user with the same IDs as host user
RUN addgroup --system --gid ${GROUP_ID} nodejs 2>/dev/null || true
RUN adduser --system --uid ${USER_ID} --ingroup nodejs nextjs 2>/dev/null || \
    adduser --system --uid ${USER_ID} nextjs 2>/dev/null || true

# Make sure git and bash are available in the container
RUN apk add --no-cache git bash

# Copy dependencies and source code
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --chown=nextjs:nodejs . .

# Ensure /app directory and all its contents are owned by nextjs:nodejs
RUN chown -R nextjs:nodejs /app

# Create directory for repositories (will be mounted as volume)
RUN mkdir -p /repos && chown -R nextjs:nodejs /repos

# Configure Git for nextjs user to trust mounted repositories
USER nextjs
RUN git config --global --add safe.directory '*'

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["npm", "run", "dev"]
