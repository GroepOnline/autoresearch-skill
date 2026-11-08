# Preview image for @groeponline/pi-autoresearch.
# Packs the npm artifact and smoke-tests the exact files pi loads
# (extension entry + skills), inside a clean container.
#
#   docker build -f preview/Dockerfile -t ghcr.io/groeponline/autoresearch-skill-preview:local .
#   docker run --rm ghcr.io/groeponline/autoresearch-skill-preview:local
FROM node:22 AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN mkdir -p /out && npm pack --pack-destination /out

FROM node:22-slim AS preview
WORKDIR /preview
COPY --from=build /out/*.tgz ./pkg.tgz
COPY preview/smoke.sh ./smoke.sh
RUN npm install ./pkg.tgz --prefix ./pkg --no-audit --no-fund && sh ./smoke.sh ./pkg
CMD ["sh", "./smoke.sh", "./pkg"]
