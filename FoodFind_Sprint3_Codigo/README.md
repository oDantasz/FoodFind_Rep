# FoodFind — Sprint 1 (versão 1.1)

MVP web para o Sprint 1.

## O que foi corrigido
- Cadastro, login e logout em `localStorage` para demonstração.
- Mapa com tiles reais do OpenStreetMap.
- Botão **Minha localização** usando a geolocalização do navegador.
- Restaurantes reais consultados em tempo real via OpenStreetMap/Overpass.
- Busca por nome/categoria.
- Perfil do restaurante com endereço, telefone, horário, site e dados disponíveis.

## Rodar localmente
```bash
npm install
npm start
```
Abra http://localhost:3000

## Docker
```bash
docker compose up --build
```

## Observações
A localização exata depende da permissão concedida pelo navegador. Se a permissão for negada, o sistema usa um ponto inicial em São Paulo.

Os dados dos restaurantes vêm do OpenStreetMap e podem ter campos incompletos.