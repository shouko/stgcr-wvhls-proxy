# syntax=docker/dockerfile:1

FROM node:18
ENV NODE_ENV=production

COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.7.1 /lambda-adapter /opt/extensions/lambda-adapter

WORKDIR /app

COPY . .
RUN yarn install --pure-lockfile

EXPOSE 3000/tcp
CMD ["yarn", "start"]
