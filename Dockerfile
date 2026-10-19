FROM node:22-alpine AS game-build
WORKDIR /game
COPY . .
RUN node tools/build.js --plain --sin-seo
RUN node tools/security-headers.js

FROM node:22-alpine AS api
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --engine-strict && npm cache clean --force
COPY --chown=node:node server/*.js server/schema.sql ./
USER node
EXPOSE 3000
CMD ["node", "index.js"]

FROM nginx:stable-alpine AS web
COPY deployment/25-trusted-proxies.sh /docker-entrypoint.d/25-trusted-proxies.sh
RUN chmod 755 /docker-entrypoint.d/25-trusted-proxies.sh
COPY deployment/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=game-build /game/deployment/security-headers.conf /etc/nginx/security-headers.conf
COPY --from=game-build /game/index.html /usr/share/nginx/html/index.html
COPY --from=game-build /game/js/app.min.js /usr/share/nginx/html/js/app.min.js
COPY --from=game-build /game/js/core/boot.js /usr/share/nginx/html/js/core/boot.js
COPY --from=game-build /game/version.json /usr/share/nginx/html/version.json
COPY oauth-result.html /usr/share/nginx/html/oauth-result.html
COPY js/oauth-result.js /usr/share/nginx/html/js/oauth-result.js
COPY assets /usr/share/nginx/html/assets
COPY css /usr/share/nginx/html/css
COPY zh-TW /usr/share/nginx/html/zh-TW
COPY en /usr/share/nginx/html/en
COPY --from=game-build /game/zh-TW/index.html /usr/share/nginx/html/zh-TW/index.html
COPY --from=game-build /game/en/index.html /usr/share/nginx/html/en/index.html
COPY guia /usr/share/nginx/html/guia
COPY pokedex /usr/share/nginx/html/pokedex
COPY movimientos /usr/share/nginx/html/movimientos
COPY objetos /usr/share/nginx/html/objetos
COPY legendarios /usr/share/nginx/html/legendarios
COPY shinies /usr/share/nginx/html/shinies
COPY tipos /usr/share/nginx/html/tipos
COPY logros /usr/share/nginx/html/logros
COPY novedades /usr/share/nginx/html/novedades
COPY apoyar /usr/share/nginx/html/apoyar
COPY contacto /usr/share/nginx/html/contacto
COPY sw.js manifest.webmanifest favicon.ico LICENSE LICENSE-NONCOMMERCIAL.md CREDITS.md /usr/share/nginx/html/
EXPOSE 80
