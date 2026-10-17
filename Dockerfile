# Image pour tout hébergeur compatible Docker (Railway, Fly.io, un VPS…).
FROM node:20-alpine
WORKDIR /app
COPY . .
ENV NODE_ENV=production PORT=8080 HIDE_STREAMERS=1
EXPOSE 8080
CMD ["node", "server.js"]
