# 1. Imagem Base
# Começamos com uma imagem oficial do Node.js.
# A versão "alpine" é mais leve, ideal para servidores.
FROM node:18-alpine

# 2. Diretório de Trabalho
# Define a pasta onde nossa aplicação vai ficar dentro do container.
WORKDIR /app

# 3. Copiar os arquivos de dependência
# Copia o package.json e o package-lock.json (se existir).
# Fazemos isso separado para aproveitar o cache do Docker.
COPY package*.json ./

# 4. Instalar as Dependências
# Usa 'npm ci' que é mais rápido e seguro para builds, pois usa o package-lock.json.
# Se você não tiver um package-lock.json, troque "npm ci" por "npm install"
RUN npm ci --omit=dev

# 5. Copiar o restante do código
# Copia todos os outros arquivos ( .js, .css, etc.) para o container.
COPY . .

# 6. Expor a Porta
# Informa ao Docker que a aplicação vai rodar na porta 3000.
# !! IMPORTANTE: Se sua aplicação usa outra porta (ex: 8080), mude este número!
EXPOSE 3000

# 7. Comando para Rodar
# O comando que será executado quando o container iniciar.
# Ele deve rodar a versão de "produção" (não "dev" com nodemon).
CMD [ "npm", "start" ]