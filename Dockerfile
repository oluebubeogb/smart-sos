FROM node:20-alpine
# ffmpeg is REQUIRED for mark-to-export (joins marked chunks into one file)
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p /data/history /data/audio /data/video
VOLUME ["/data"]
ENV DATA_DIR=/data
EXPOSE 7474
CMD ["node", "server.js"]
