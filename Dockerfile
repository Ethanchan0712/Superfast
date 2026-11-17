FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 後端 + 靜態 PWA
COPY server ./server
COPY index.html manifest.webmanifest sw.js offline.html robots.txt /app/
COPY css/ /app/css/
COPY js/ /app/js/
COPY icons/ /app/icons/

RUN mkdir -p /data

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1

CMD ["node", "server/server.js"]
