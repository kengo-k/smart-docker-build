FROM node:20

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.js ./

ENTRYPOINT ["node", "/app/index.js"]
