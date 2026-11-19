# FoodFind 4.0 — imagem de produção
FROM node:20-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    FOODFIND_DATA_DIR=/app/data

WORKDIR /app

# Dependências primeiro (aproveita o cache de camadas)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Código da aplicação, pertencendo ao usuário sem privilégios "node" (uid 1000)
COPY --chown=node:node . .
RUN mkdir -p /app/data /app/backups && chown -R node:node /app/data /app/backups

USER node

EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
