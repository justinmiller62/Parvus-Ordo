# clip-cutter — Node + ffmpeg. Deploys to Cloudflare Containers (or any container host).
FROM node:22-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY server.mjs ./
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
