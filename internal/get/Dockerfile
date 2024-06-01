FROM node:20

RUN apt-get update && apt-get install -y docker.io

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.js ./

ENTRYPOINT ["node", "/app/index.js"]
