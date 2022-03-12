# syntax=docker/dockerfile:1

FROM node:14
ENV NODE_ENV=production

WORKDIR /app

COPY . .
RUN yarn install --pure-lockfile

EXPOSE 3000/tcp
CMD ["yarn", "start"]
