# FoodFind (versão 4.0.0)

Web app para **descobrir restaurantes próximos**, ver perfil, cardápio, fotos e avaliações e **resgatar descontos por QR Code** no próprio restaurante.

Projeto acadêmico da **FATEC Ipiranga**, curso de Análise e Desenvolvimento de Sistemas (noturno), disciplina **Laboratório de Engenharia de Software** (Prof. Veríssimo).
Grupo: **Pedro Augusto Dantas Aranda** e **Vinicius Tofani Siqueira**.

---

## Sumário
1. [Funcionalidades](#funcionalidades)
2. [Como rodar localmente](#como-rodar-localmente)
3. [Como rodar com Docker](#como-rodar-com-docker)
   - [Publicar grátis no Render](#publicar-grátis-no-render-com-dados-salvos-no-neon)
4. [Variáveis de ambiente](#variáveis-de-ambiente)
5. [Contas de demonstração (seed)](#contas-de-demonstração-seed)
6. [Testes automatizados e CI](#testes-automatizados-e-ci)
7. [Rotas da API](#rotas-da-api)
8. [Estrutura de pastas](#estrutura-de-pastas)
9. [Decisões técnicas](#decisões-técnicas)
10. [Segurança e LGPD](#segurança-e-lgpd)
11. [Backup e dados](#backup-e-dados)
12. [Publicar no GitHub e no Docker Hub](#publicar-no-github-e-no-docker-hub)
13. [Limitações conhecidas](#limitações-conhecidas)
14. [Documentação complementar](#documentação-complementar)

---

## Funcionalidades

**Cliente**
- Busca de restaurantes perto da localização do navegador (com aviso de consentimento antes de pedir a permissão) ou **por endereço/bairro** (também usada quando a permissão é negada).
- Mapa com marcadores agrupados, nota média no pin e resumo no popup; botão **"Buscar nesta área"** ao mover o mapa.
- Filtros: categoria (restaurante, pizzaria, lanchonete, fast-food, café, bar, padaria, sorveteria, doceria), faixa de preço, aberto agora, nota mínima e distância; ordenação por distância, nota ou nome.
- Perfil com fotos, cardápio, horários (aberto/fechado agora no horário de São Paulo), contatos e **avaliações** (média, quantidade, distribuição por estrelas, paginação).
- Avaliar restaurantes **cadastrados e do OpenStreetMap** (1 a 5 estrelas + comentário de até 600 caracteres), editar com o formulário preenchido e excluir a própria avaliação.
- Botão global **"Ler QR Code"**: câmera com `BarcodeDetector` ou, como alternativa (iPhone/Safari, Firefox), **jsQR**; também é possível digitar o código.
- O QR leva para `/?resgatar=CODIGO`: se não estiver logado, o código é guardado e o resgate acontece logo após o login.
- **Comprovante (voucher)** com restaurante, benefício, validade, número `FF-000123` e código de conferência; histórico em **Meus benefícios**.

**Restaurante (dono)**
- Painel para cadastrar/editar/excluir restaurantes: dados, site, contatos, localização no mapa, até 12 fotos, horários e cardápio.
- **Pedido para assumir** um restaurante que já aparece no OpenStreetMap (fica *pendente* até o administrador aprovar).
- **Campanhas e vouchers**: criar, editar, pausar/ativar e excluir campanhas; status (agendada, ativa, pausada, encerrada, esgotada), usos e limite.
- **QR Code gerado no servidor** (SVG, biblioteca `qrcode`), visível só para o dono: ver em tamanho grande, **imprimir cartaz A5**, **baixar SVG** e gerar novo código se o antigo vazar.
- **Validar voucher** pelo número + código de conferência (cada voucher só pode ser usado uma vez).

**Administrador** (conta definida por `ADMIN_EMAIL`)
- **Visão geral**: contas (clientes e restaurantes), contas ativas nos últimos 7 dias, visitas por dia (só o total, sem IP), restaurantes, campanhas ativas, resgates e avaliações, com gráfico dos últimos 14 dias.
- **Usuários**: nome, e-mail, tipo, data de cadastro, último acesso e atividade de cada conta, com busca e filtro por tipo.
- Aprovar ou recusar pedidos de reivindicação.
- Redefinir a senha de um usuário (gera senha temporária), já que não há serviço de e-mail.

**Conta e LGPD**
- Editar nome, trocar senha, **sair de todos os dispositivos**, **exportar meus dados (JSON)** e **excluir a conta** (com confirmação por senha).
- Páginas de **Política de Privacidade** e **Termos de Uso** dentro do app; aceite obrigatório no cadastro.

**Experiência**
- Rotas na URL (`#/restaurante/ff-12`, `#/painel`, `#/campanhas`, `#/beneficios`, `#/conta`, `#/admin`, `#/privacidade`, `#/termos`): voltar, F5 e compartilhamento funcionam.
- Acessível por teclado (cards, modais com foco preso e ESC, rótulos em todos os campos), contraste AA e layout testado em 360 px.
- **PWA**: manifest, ícones e service worker (cache só do shell, nunca da API). Guia de APK em [`docs/guia-apk.md`](docs/guia-apk.md).

---

## Como rodar localmente

Requisito: **Node.js 20 ou mais novo** (o `npm install` já instala o SQLite em WebAssembly; não precisa de nenhum programa extra, nem no Windows).

```bash
npm install
npm run seed        # opcional: contas e dados de demonstração
npm start           # http://localhost:3000
```

Com variáveis de ambiente em um arquivo `.env` (copie de `.env.example`):

```bash
cp .env.example .env
npm run start:env
```

Outros comandos:

| Comando | O que faz |
|---|---|
| `npm start` | Sobe o servidor (porta `PORT`, padrão 3000) |
| `npm run start:env` | Igual ao anterior, lendo o arquivo `.env` (Node 20.6+) |
| `npm run dev` | Modo desenvolvimento (libera `/api/map-check` sem login) |
| `npm test` | Testes automatizados (sobem o servidor real) |
| `npm run seed` | Cria dados de demonstração com o servidor **parado** (`-- --reset` recria; `-- --detalhes` mostra o link de resgate) |
| `npm run backup` | Copia a pasta de dados para `backups/foodfind-AAAAMMDD-HHMMSS` |

> A câmera do celular só funciona em **HTTPS** ou em `localhost`. Para testar a leitura do QR em um celular na rede local, publique atrás de HTTPS (por exemplo, um túnel HTTPS ou um serviço de hospedagem) e defina `PUBLIC_URL`.

---

## Como rodar com Docker

```bash
cp .env.example .env              # ajuste ADMIN_EMAIL, ADMIN_PASSWORD e PUBLIC_URL
docker compose up --build -d
docker compose ps                 # a coluna STATUS mostra (healthy) após o healthcheck
```

Dados de demonstração no Docker (o seed grava direto no banco, então o servidor precisa estar parado; com ele no ar o script se recusa a rodar):

```bash
docker compose stop foodfind
docker compose run --rm foodfind npm run seed
docker compose start foodfind
```

- Imagem baseada em `node:20-alpine`, roda como usuário **não-root** (`node`, uid 1000).
- **HEALTHCHECK** consulta `GET /api/health` a cada 30 s.
- Os dados ficam no volume nomeado **`foodfind-data`** (montado em `/app/data`) e **sobrevivem** a `docker compose down` e à recriação do container. Só `docker compose down -v` apaga o volume.
- Backup dentro do container: `docker compose exec foodfind npm run backup` grava em `/app/data/backups`; para copiar para o computador: `docker compose cp foodfind:/app/data/backups ./backups`.

Por que volume nomeado e não `./data`? Com usuário não-root, uma pasta `./data` criada pelo Docker no Linux pertence ao root e o app não consegue gravar. Se preferir a pasta local, troque a linha do volume por `- ./data:/app/data` e rode antes `mkdir -p data && sudo chown -R 1000:1000 data` (no Docker Desktop para Windows/Mac não é preciso o `chown`).

### Publicar grátis no Render (com dados salvos no Neon)

O FoodFind roda no plano gratuito do [Render](https://render.com), com endereço `https://` próprio (a câmera do celular funciona para ler o QR). O disco do Render gratuito é apagado quando o serviço reinicia ou dorme; por isso o banco e as fotos ficam guardados num PostgreSQL gratuito do [Neon](https://neon.com) (variável `DATABASE_URL`).

**1. Banco no Neon (grátis)**
1. Crie uma conta em neon.com e um projeto (região mais próxima, ex.: AWS São Paulo, se houver; senão US East).
2. Em **Connect**, copie o endereço de conexão (`postgresql://usuario:senha@...neon.tech/neondb?sslmode=require...`). Ele é um segredo: não coloque no GitHub.

**Rodar no seu computador usando o banco do Neon (opcional):** o projeto já está ligado ao Neon (`neon.ts` e `.neon`, criados por `neon init`). Com a [CLI do Neon](https://www.npmjs.com/package/neon) instalada (`npm i -g neon`):
```bash
neon login          # abre o navegador para entrar na conta do Neon
neon deploy         # aplica o neon.ts e grava as variáveis em .env.local (nunca versionado)
npm run seed:neon   # opcional: dados de demonstração no banco do Neon
npm run start:neon  # sobe o FoodFind lendo DATABASE_URL do .env.local
```
O FoodFind usa só o PostgreSQL (`DATABASE_URL`). Os demais serviços declarados no `neon.ts` (auth, ai-gateway, functions, object-storage, realtime) não são usados pelo app; remova-os do arquivo antes do `neon deploy` se não quiser criá-los.

**2. Serviço no Render**
- Pelo arquivo [`render.yaml`](render.yaml) (projeto na raiz do repositório): **New → Blueprint**, escolha o repositório e preencha `SEED_PASSWORD` e `DATABASE_URL`.
- Ou manualmente: **New → Web Service**, linguagem **Docker**, plano **Free**, *Health Check Path* `/api/health`, *Docker Command* `sh start-render.sh` e as variáveis `PORT=3000`, `TRUST_PROXY=1`, `ADMIN_EMAIL`, `SEED_PASSWORD` e `DATABASE_URL`. Se o projeto estiver numa subpasta do repositório, informe-a em **Root Directory**.

Como funciona:
- Na inicialização, o FoodFind baixa do PostgreSQL a cópia do banco e as fotos; a cada alteração, envia a cópia de volta (e espera terminar ao receber SIGTERM). O `start-render.sh` roda o seed, que só cria os dados de demonstração se eles ainda não existirem.
- Se o PostgreSQL não responder na inicialização, o servidor **não sobe** (evita começar com um banco vazio e apagar a cópia boa). Durante um novo deploy, o processo antigo para de gravar quando o novo assume o banco.
- O serviço gratuito **dorme após 15 minutos sem acesso** e leva cerca de **1 minuto** para acordar. Abra o link um pouco antes de apresentar.
- Sem `DATABASE_URL`, tudo funciona, mas os dados voltam ao estado da demonstração a cada reinício.

---

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta HTTP. |
| `PUBLIC_URL` | (vazio) | Endereço público usado no link do QR Code (`{PUBLIC_URL}/?resgatar=CODIGO`). Sem ela, usa o host da requisição. |
| `ADMIN_EMAIL` | (vazio) | E-mail da conta administradora (aprova reivindicações, redefine senhas, vê `/api/map-check`). Esse e-mail fica reservado: ninguém consegue se cadastrar com ele pelo app. |
| `ADMIN_PASSWORD` | (vazio) | Senha inicial do administrador. Se a conta de `ADMIN_EMAIL` não existir, ela é criada na inicialização. Troque depois em "Minha conta". |
| `FOODFIND_DATA_DIR` | `./data` | Pasta do banco `foodfind.db` e das fotos (`uploads/`). |
| `FOODFIND_BACKUP_DIR` | `./backups` | Destino do `npm run backup`. |
| `TRUST_PROXY` | `0` | `1` quando estiver atrás de proxy reverso confiável (usa `X-Forwarded-For`/`X-Forwarded-Host`). O cookie recebe `Secure` sempre que a requisição chega por HTTPS ou com `X-Forwarded-Proto: https`. |
| `DATABASE_URL` | (vazio) | Opcional. PostgreSQL onde ficam uma cópia do banco e as fotos (ex.: Neon gratuito). Use em hospedagens que apagam o disco, como o Render gratuito. Se estiver definida e o banco não responder, o servidor não inicia (para não subir vazio). |
| `HOST` | `0.0.0.0` | Interface de rede. |
| `NODE_ENV` | — | `production` na imagem Docker. `development` (ou `npm run dev`) libera `/api/map-check`. |

Ajustes opcionais (normalmente não precisam ser alterados; os testes usam alguns deles):
`FOODFIND_LOGIN_MAX_PER_EMAIL` (5), `FOODFIND_LOGIN_MAX_PER_IP` (20/15 min), `FOODFIND_REGISTER_MAX_PER_IP` (10/h), `FOODFIND_REDEEM_MAX_FAILS` (10/15 min), `FOODFIND_GEOCODE_MAX_PER_MIN` (30), `FOODFIND_TILES_MAX_PER_MIN` (600), `FOODFIND_SEARCH_MAX_PER_MIN` (60), `FOODFIND_OVERPASS_URL` e `FOODFIND_NOMINATIM_URL` (servidores do OpenStreetMap; os testes apontam para um simulador local), `SEED_PASSWORD`.

---

## Contas de demonstração (seed)

`npm run seed` cria (senha de todas: **`FoodFind@2026`**):

| E-mail | Tipo | Uso na demonstração |
|---|---|---|
| `admin@foodfind.local` | Cliente + administrador* | Aprovar reivindicações, redefinir senha |
| `cliente@foodfind.local` | Cliente | Avaliar, ler QR, ver benefícios |
| `cliente2@foodfind.local` | Cliente | Já tem um voucher emitido (para o dono validar) |
| `restaurante@foodfind.local` | Restaurante | Dono da *Cantina Bella Paulista* e do *Sushi Paraíso* |
| `restaurante2@foodfind.local` | Restaurante | Dona da *Padaria Pão da Augusta* |

\* É administrador quando `ADMIN_EMAIL=admin@foodfind.local` (padrão do `.env.example` e do `docker-compose.yml`).
Campanhas criadas: **ativa** (Cantina), **agendada** (Cantina), **pausada** (Sushi) e **encerrada** (Padaria). Os restaurantes ficam na região da Av. Paulista (ponto inicial do mapa).

---

## Testes automatizados e CI

```bash
npm test
```

- Usa o `node:test` nativo. Cada arquivo de `test/` **sobe o servidor real** (`node server.js`) em uma porta livre, com **banco temporário**, e chama a API por HTTP.
- O OpenStreetMap é substituído por um **simulador local** (Overpass + Nominatim) — nenhum teste depende da internet. Um teste também derruba o OSM e confirma que a busca responde só com os cadastrados.
- Cobertura: cadastro e login, limite de tentativas, sessão (hash do token, rotação, logout), painel, busca e filtros, links maliciosos, reivindicação, avaliações (permissões, duplicidade, média, edição, exclusão, paginação, OSM), campanhas (validações, dono, estados, fuso de São Paulo, QR em SVG, **segredo nunca em rotas públicas**), resgate (todos os erros), voucher, histórico, exclusão em cascata, exclusão e exportação de conta, upload inválido, cabeçalhos de segurança, SRI, CSRF, arquivos estáticos, PWA, versões, migração de banco antigo, backup e seed.
- Persistência no PostgreSQL: a suíte `test/persistence.test.js` roda quando `FOODFIND_TEST_DATABASE_URL` aponta para um PostgreSQL de teste (sem ela, é pulada). Ela confere que banco e fotos voltam num servidor com disco vazio, que o seed grava lá, que um processo antigo não sobrescreve o novo e que o servidor não sobe se o banco estiver fora do ar.
- **GitHub Actions** (`.github/workflows/ci.yml`): a cada *push* e *pull request* roda `npm ci` + `npm test` no Node 20 (com um PostgreSQL de serviço para a suíte de persistência) e, em seguida, constrói a imagem Docker e espera o healthcheck ficar `healthy`.

---

## Rotas da API

Respostas em JSON. Erros: `{ "message": "...", "code": "..." }`. Rotas que alteram dados exigem `Content-Type: application/json` e recusam origem de outro site (CSRF).

### Autenticação
| Método | Rota | Acesso | Descrição |
|---|---|---|---|
| POST | `/api/auth/register` | público | Cria conta (`name`, `email`, `password` ≥ 8, `role`: `cliente`/`restaurante`, `acceptTerms: true`) |
| POST | `/api/auth/login` | público | Entra (`email`, `password`); mensagem genérica em caso de erro |
| POST | `/api/auth/logout` | logado | Sai deste dispositivo |
| GET | `/api/auth/me` | público | Usuário logado (`null` se não houver) |

### Minha conta (LGPD)
| Método | Rota | Acesso | Descrição |
|---|---|---|---|
| PUT | `/api/me` | logado | Edita o nome |
| POST | `/api/me/password` | logado | Troca a senha (`currentPassword`, `newPassword`); encerra outras sessões |
| POST | `/api/me/logout-all` | logado | Sai de todos os dispositivos |
| GET | `/api/me/export` | logado | Baixa todos os meus dados em JSON |
| DELETE | `/api/me` | logado | Exclui a conta (`password`) e tudo o que é dela |
| GET | `/api/me/redemptions` | cliente | Meus benefícios (vouchers) |

### Busca e perfis (públicas)
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/restaurants?lat=&lng=&q=&category=&price=&open=1&minRating=&radius=&sort=` | Busca (OSM + cadastrados). `category` aceita uma ou várias separadas por vírgula (ex.: `Bar,Pizzaria`). `sort`: `distance`, `rating`, `name`; `radius` em km (0,5 a 10) |
| GET | `/api/restaurants/:ref` | Perfil. `:ref` = `ff-12` (cadastrado) ou `node-123`/`way-123`/`relation-123` (OSM) |
| GET | `/api/restaurants/:ref/reviews?page=&limit=` | Avaliações paginadas (mais recentes primeiro), média, quantidade, distribuição e a minha |
| POST | `/api/restaurants/:ref/reviews` | Cria ou atualiza a minha avaliação (cliente) |
| GET / PUT / DELETE | `/api/restaurants/:ref/reviews/mine` | Ver, criar/atualizar ou excluir a minha avaliação (cliente) |
| GET | `/api/campaigns/nearby?lat=&lng=&radius=` | Descontos vigentes perto de um ponto (vitrine da tela inicial, **sem o código**) |
| GET | `/api/restaurants/:ref/campaigns` | Campanhas vigentes: título, benefício, validade e se há vagas (**sem o código**) |
| GET | `/api/geocode?q=` | Endereço → coordenadas (só a partir do próprio site, com cache e limite por IP) |
| GET | `/api/health` | `{ ok, version }` (usado pelo healthcheck) |
| POST | `/api/visit` | Soma 1 nas visitas do dia (sem IP nem cookie; o site chama uma vez por aba) |

### Painel do restaurante (conta Restaurante)
| Método | Rota | Descrição |
|---|---|---|
| GET / POST | `/api/my/restaurants` | Lista / cria restaurantes |
| PUT / DELETE | `/api/my/restaurants/:id` | Edita / exclui (apaga campanhas, vouchers, fotos e avaliações próprias) |
| POST | `/api/uploads` | Envia foto (`dataUrl` JPG/PNG/WEBP até 5 MB; conteúdo conferido) |
| GET / POST | `/api/my/claims` | Meus pedidos para assumir restaurantes do OSM / novo pedido |
| DELETE | `/api/my/claims/:id` | Cancela pedido pendente |
| GET / POST | `/api/my/campaigns` | Lista (com código, status, usos e limite) / cria campanha |
| GET / PUT / DELETE | `/api/my/campaigns/:id` | Detalha / edita / exclui (com os resgates) |
| POST | `/api/my/campaigns/:id/status` | Pausa ou ativa (`active: true/false`) |
| POST | `/api/my/campaigns/:id/new-code` | Gera um novo código secreto (o QR antigo deixa de valer) |
| GET | `/api/my/campaigns/:id/qr.svg` | QR Code em SVG (`?download=1` para baixar) |
| GET | `/api/my/campaigns/:id/vouchers` | Vouchers emitidos na campanha |
| GET | `/api/my/vouchers/:numero` | Consulta voucher (`FF-000123`) de um restaurante meu |
| POST | `/api/my/vouchers/:numero/use` | Marca como usado (`checkCode`); só uma vez |

### Resgate (conta Cliente)
| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/campaigns/redeem` | `{ code }` (código ou link do QR). Sucesso **201** com o voucher |

Erros do resgate:

| Status | `code` | Motivo |
|---|---|---|
| 400 | `missing_code` | Código não informado |
| 401 | `auth_required` | Não está logado |
| 403 | `not_client` | Conta não é do tipo Cliente |
| 404 | `invalid_code` | Código inválido |
| 409 | `campaign_not_started` | Campanha ainda não começou (informa quando começa) |
| 410 | `campaign_ended` | Campanha encerrada |
| 423 | `campaign_paused` | Campanha pausada |
| 409 | `already_redeemed` | Já resgatada por este usuário |
| 409 | `campaign_sold_out` | Limite de usos atingido |
| 429 | `too_many_attempts` | Muitos códigos inválidos seguidos |

### Administração (conta `ADMIN_EMAIL`)
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/admin/claims?status=pendente\|aprovado\|recusado` | Pedidos de reivindicação |
| POST | `/api/admin/claims/:id/approve` | Aprova (cria o restaurante para o solicitante) |
| POST | `/api/admin/claims/:id/reject` | Recusa (`reason`) |
| GET | `/api/admin/users?q=&role=&page=&limit=` | Contas: nome, e-mail, tipo, cadastro, último acesso e atividade (sem senha) |
| GET | `/api/admin/stats` | Totais e série dos últimos 14 dias (visitas, cadastros, resgates) |
| POST | `/api/admin/users/reset-password` | Gera senha temporária para `email` |
| GET | `/api/map-check` | Diagnóstico dos servidores de mapa (admin ou modo dev) |

Outras rotas: `GET /tiles/:z/:x/:y` (mapa via servidor, só a partir do próprio site), `GET /uploads/:arquivo` (fotos).

---

## Estrutura de pastas

```
.
├── server.js              ← servidor HTTP (módulo http nativo) e rotas da API em api()
├── db.js                  ← SQLite (sql.js): esquema, migração, gravação atômica
├── lib/
│   ├── http.js            ← send, httpError, readBody, arquivos estáticos com gzip
│   ├── validate.js        ← str() e clean*() (URLs, telefones, horários, cardápio, fotos)
│   ├── security.js        ← senhas (scrypt), sessões, cookies, limites, cabeçalhos, CSRF
│   ├── osm.js             ← OpenStreetMap (Overpass): busca, categorias, opening_hours
│   ├── remote.js          ← cópia do banco e das fotos no PostgreSQL (DATABASE_URL), opcional
│   └── time.js            ← datas em America/Sao_Paulo
├── public/
│   ├── index.html         ← todas as telas (SPA com rotas em hash)
│   ├── app.js             ← front-end (JavaScript puro, sem handlers inline)
│   ├── glassfold.js       ← fundo animado do topo (shader Glass Fold da GradFlow, licença MIT)
│   ├── fluxo.js           ← fundo da página: fita de linhas em canvas (ideia do Background Paths, Kokonut UI)
│   ├── styles.css         ← visual, responsivo e impressão do cartaz A5
│   ├── sw.js              ← service worker (PWA)
│   ├── manifest.webmanifest
│   ├── icons/             ← ícones do app
│   └── fonts/             ← fontes Barlow e Barlow Condensed (licença SIL OFL)
├── scripts/
│   ├── seed.js            ← dados de demonstração
│   └── backup.js          ← cópia da pasta de dados com data e hora
├── test/                  ← testes node:test (servidor real + OSM simulado)
├── docs/                  ← plano de teste, manual, documentação técnica, roteiros
├── .github/workflows/ci.yml
├── Dockerfile, docker-compose.yml, .dockerignore
├── .env.example, .gitignore
└── package.json, package-lock.json
```

A pasta `data/` (banco e fotos) é criada sozinha na primeira execução e **não é versionada**.

---

## Decisões técnicas

- **Stack mantida**: Node.js 20 com `http` nativo (sem Express), SQLite via `sql.js`, front-end em JavaScript puro com Leaflet. Única dependência nova: **`qrcode`** (geração do QR no servidor, sem enviar o código a serviços externos).
- **Bibliotecas de front-end por CDN com SRI**: Leaflet 1.9.4, Leaflet.markercluster 1.5.3 e jsQR 1.4.0 vêm do `unpkg.com` com `integrity` (SHA-384) e `crossorigin`. As fontes foram trazidas para `public/fonts` (Google Fonts não oferece SRI).
- **Código da campanha**: 16 caracteres gerados com `crypto.randomBytes` (80 bits), alfabeto sem letras ambíguas. Só aparece nas rotas do dono e no QR. A lista pública mostra título, benefício, validade e se há vagas.
- **Voucher com código de conferência**: o número `FF-000123` é sequencial; para evitar que alguém invente um número e use o voucher de outra pessoa, o comprovante traz também um código de conferência de 4 caracteres, que o dono confere ao validar.
- **Avaliações por lugar (`place_ref`)**: `ff-12` para restaurantes criados no FoodFind e `node-123` etc. para lugares do OSM. Quando um lugar do OSM é assumido, as avaliações antigas continuam valendo; se o dono excluir o perfil, as avaliações do lugar permanecem.
- **Reivindicação aprovada por administrador**: evita que qualquer conta "tome" um restaurante real do mapa.
- **Banco**: esquema versionado (`PRAGMA user_version = 5`), chaves estrangeiras com `ON DELETE CASCADE`, índices, transações e **gravação atômica** (arquivo temporário + `fsync` + `rename`). Bancos das versões 2.2/3 são migrados automaticamente na primeira execução (as sessões antigas, que guardavam o token em texto puro, são descartadas).
- **Datas**: o formulário envia o horário local de São Paulo; o servidor converte para UTC e mostra tudo em `America/Sao_Paulo`.
- **Docker com volume nomeado**: necessário para rodar como usuário não-root sem problemas de permissão.

---

## Segurança e LGPD

- Senhas com **scrypt** + salt; mínimo de 8 caracteres; login com mensagem genérica e tempo de resposta equivalente para e-mails inexistentes.
- **Limite de tentativas** por IP e por e-mail no login e no cadastro (bloqueio temporário com mensagem e `Retry-After`), no resgate de códigos e na validação de vouchers.
- Sessão: cookie `HttpOnly`, `SameSite=Lax`, `Secure` em HTTPS/proxy; o banco guarda só o **SHA-256 do token**; **rotação** no login; limpeza periódica de sessões expiradas.
- Cabeçalhos: **Content-Security-Policy** (sem `unsafe-inline`), `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`/`frame-ancestors`, `Permissions-Policy` (câmera e localização só para o próprio site), HSTS em HTTPS.
- **CSRF**: alterações exigem JSON e origem do próprio site.
- Links: todo site/telefone/URL de origem externa (inclusive do OpenStreetMap) passa por `cleanUrl()`/`cleanPhone()`; `javascript:` e `data:` nunca chegam a um `href`.
- `/api/geocode` e `/tiles` exigem origem do próprio site, têm limite por IP e cache; `/api/map-check` só para o administrador (ou modo dev).
- Upload: confere os **magic bytes** (JPG/PNG/WEBP), limita a 5 MB, só aceita fotos do próprio dono e **apaga fotos órfãs** (removidas, de restaurantes excluídos ou nunca usadas em 24 h).
- Logs sem senhas, tokens ou códigos; `uncaughtException`/`unhandledRejection` registrados sem derrubar o servidor.
- LGPD: consentimento antes de usar a localização (que não é armazenada), aceite dos termos, exportação e exclusão de dados, nomes abreviados nas avaliações. O administrador vê nome, e-mail, tipo, cadastro e último acesso das contas (informado na Política de Privacidade); visitas são contadas só pelo total do dia, sem IP.

### Recuperação de senha
Recuperação **por e-mail** depende de um serviço de envio de e-mails (SMTP ou API como SendGrid/Amazon SES), que este projeto não tem. Alternativa implementada: o **administrador redefine a senha** em *Administração → Redefinir senha de um usuário*; o sistema gera uma senha temporária (mostrada uma única vez), encerra as sessões do usuário, e ele troca a senha em *Minha conta*. Para produção, recomenda-se integrar um serviço de e-mail com link de uso único e expiração curta.

---

## Backup e dados

```
data/
├── foodfind.db    ← banco SQLite (abre no "DB Browser for SQLite")
└── uploads/       ← fotos enviadas pelos restaurantes
```

`npm run backup` copia essa pasta para `backups/foodfind-AAAAMMDD-HHMMSS/`. Para restaurar, pare o servidor e copie o conteúdo do backup de volta para a pasta de dados.

---

## Publicar no GitHub e no Docker Hub

**GitHub**
```bash
git add -A
git commit -m "FoodFind 4.0.0: Sprint 3 completa, segurança, LGPD, PWA, Docker e testes"
git push origin main
```
O workflow de CI roda sozinho; acompanhe em *Actions*.

**Docker Hub** (troque `SEU_USUARIO`):
```bash
docker login
docker build -t SEU_USUARIO/foodfind:4.0.0 -t SEU_USUARIO/foodfind:latest .
docker push SEU_USUARIO/foodfind:4.0.0
docker push SEU_USUARIO/foodfind:latest
# Para rodar a partir da imagem publicada:
docker run -d --name foodfind -p 3000:3000 -v foodfind-data:/app/data \
  -e ADMIN_EMAIL=admin@foodfind.local -e ADMIN_PASSWORD='troque-esta-senha' \
  SEU_USUARIO/foodfind:4.0.0
```

---

## Limitações conhecidas

- Mapa, restaurantes públicos e busca por endereço dependem do OpenStreetMap (internet). Sem ele, a busca mostra só os restaurantes cadastrados e avisa o usuário.
- Leitura por câmera depende do navegador, da permissão e de HTTPS (ou `localhost`).
- Não há envio de e-mail (veja *Recuperação de senha*).
- O SQLite em WebAssembly grava o banco inteiro a cada alteração (e, com `DATABASE_URL`, envia a cópia inteira ao PostgreSQL): adequado para o porte do projeto acadêmico, não para milhares de usuários simultâneos nem para mais de uma instância do servidor ao mesmo tempo.

---

## Documentação complementar

| Documento | Arquivo |
|---|---|
| Plano de Teste (modelo da disciplina) | [`docs/plano-de-teste.pdf`](docs/plano-de-teste.pdf) |
| Manual do usuário (cliente e restaurante) | [`docs/manual-do-usuario.md`](docs/manual-do-usuario.md) |
| Documentação técnica | [`docs/documentacao-tecnica.md`](docs/documentacao-tecnica.md) |
| Roteiro do vídeo (até 15 min) | [`docs/roteiro-video.md`](docs/roteiro-video.md) |
| Roteiro de demonstração e checklist de homologação | [`docs/roteiro-demonstracao-e-homologacao.md`](docs/roteiro-demonstracao-e-homologacao.md) |
| Guia para gerar APK (PWABuilder/Capacitor) | [`docs/guia-apk.md`](docs/guia-apk.md) |
