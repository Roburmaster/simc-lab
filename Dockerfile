# SimC Lab server. The image holds the app and the tools to build SimulationCraft; SimC itself is compiled into
# the /data volume from the web interface (or automatically with SIMC_LAB_AUTO_UPDATE=1), so a WoW patch never
# needs a new image. SimC writes its HTML reports (and the Armory import reads one) under en_US.UTF-8, so the
# image generates that locale. See docs/server.md.
FROM node:24-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git cmake build-essential libcurl4-openssl-dev ca-certificates tini locales \
 && sed -i 's/^# *en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen && locale-gen \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json server.mjs LICENSE ./
COPY lib lib
COPY public public
COPY profiles profiles
COPY scripts/invite-keys.mjs scripts/

RUN mkdir /data && chown node:node /data
USER node
ENV NODE_ENV=production SIMC_LAB_SERVER=1 SIMC_LAB_HOME=/data HOST=0.0.0.0 PORT=8642
VOLUME /data
EXPOSE 8642
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/login').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["tini","--"]
CMD ["node","server.mjs"]
