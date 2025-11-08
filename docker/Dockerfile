# Upgrade security-sensitive libraries
USER root
RUN apk update && \
    apk add --no-cache --upgrade \
      openssl=3.3.4-r0 \
      expat=2.7.2-r0 \
      curl \
      libxml2 && \
    rm -rf /var/cache/apk/*
