FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

RUN apk add --no-cache bash=5.3.9-r1

WORKDIR /src/graphql-sequelize
RUN chown node:node /src/graphql-sequelize

USER node

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY --chown=node:node . .
RUN npm rebuild && npm run build

CMD ["npm", "test"]
