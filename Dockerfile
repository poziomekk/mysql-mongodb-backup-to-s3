FROM node:18-alpine

WORKDIR /root

COPY package*.json tsconfig.json ./ 
COPY src ./src

RUN npm ci
RUN npm run build

ENTRYPOINT ["node", "dist/index.js"]
