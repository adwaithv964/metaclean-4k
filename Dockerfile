FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json tsconfig.json .env.example ./
COPY src ./src
COPY public ./public
COPY tests ./tests
RUN npm install
RUN npm run build
RUN npm prune --omit=dev
RUN mkdir -p /app/tmp
ENV NODE_ENV=production
ENV HOST=0.0.0.0
EXPOSE 8787
USER node
CMD ["node", "dist/src/server.js"]
