FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json server.mjs run.mjs ./
USER node
EXPOSE 8443
CMD ["node", "run.mjs"]
