FROM node:18

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build

USER node

ENTRYPOINT [ "node", "dist/app.js" ]