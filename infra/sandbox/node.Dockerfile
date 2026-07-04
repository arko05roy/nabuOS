FROM node:20-alpine

RUN apk add --no-cache tini \
  && addgroup -S nabu && adduser -S nabu -G nabu \
  && mkdir -p /artifact /scratch \
  && chown nabu:nabu /scratch

WORKDIR /artifact
USER nabu
ENTRYPOINT ["/sbin/tini", "--"]
