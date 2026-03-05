FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY src/ ./src/
COPY migrations/ ./migrations/

RUN mkdir -p sessions logs

EXPOSE 3000

CMD ["node", "src/server.js"]
