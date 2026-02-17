# Imagen liviana y moderna
FROM node:20-alpine

WORKDIR /app

# Instala deps primero (mejor cache)
COPY package*.json ./
RUN npm ci --omit=dev

# Copia el resto
COPY . .

# El server escucha por PORT (por default 3000)
ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm","start"]
