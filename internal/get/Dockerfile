FROM node:20

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
COPY *.ts ./
RUN npm ci && npm run build

ENTRYPOINT ["node", "/app/dist/index.js"]
