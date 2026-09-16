FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./

EXPOSE 3000

USER node

CMD ["node", "server.js"]