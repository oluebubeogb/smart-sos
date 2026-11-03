FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p /data/history /data/audio /data/video
VOLUME ["/data"]
ENV DATA_DIR=/data
EXPOSE 7474
CMD ["node", "server.js"]
