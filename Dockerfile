FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p /data/history /data/audio
VOLUME ["/data"]
ENV DATA_DIR=/data
EXPOSE 8080
CMD ["node", "server.js"]
