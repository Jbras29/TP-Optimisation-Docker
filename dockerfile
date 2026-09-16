FROM node:latest
WORKDIR /app
COPY . /app
RUN npm ci --omit=dev
EXPOSE 3000 4000 5000
ENV NODE_ENV=development
RUN npm run build
USER root
CMD ["node", "server.js"]