#!/bin/sh
# Início no Render (plano gratuito): o disco é apagado ao reiniciar, então recria os dados
# de demonstração antes de subir o servidor. Se o seed falhar, o servidor sobe mesmo assim.
node scripts/seed.js
exec node server.js
