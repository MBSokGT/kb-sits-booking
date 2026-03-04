FROM node:20-alpine

RUN apk add --no-cache sqlite

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_FILE=/app/data/kb-sits.sqlite

EXPOSE 3000

CMD ["npm", "start"]
