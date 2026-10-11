FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY package-lock.json ./
RUN npm ci --omit=dev

COPY index.html style.css script.js server.js ./
COPY test ./test

ENV PORT=80
EXPOSE 80

RUN npm test

CMD ["node", "server.js"]
