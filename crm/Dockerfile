FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && rm -rf data/*.db*
ENV NODE_ENV=production PORT=3000 CRM_DB_PATH=/data/crm.db
EXPOSE 3000
CMD ["npm", "start"]
