FROM python:3.12-alpine

RUN apk add --no-cache tini py3-pip \
  && addgroup -S nabu && adduser -S nabu -G nabu \
  && mkdir -p /artifact /scratch \
  && chown nabu:nabu /scratch

WORKDIR /artifact
USER nabu
ENTRYPOINT ["/sbin/tini", "--"]
