# FoodFind 4.0.0 — Documentação técnica

Projeto acadêmico · FATEC Ipiranga · ADS Noturno · Laboratório de Engenharia de Software (Prof. Veríssimo)
Grupo: Pedro Augusto Dantas Aranda e Vinicius Tofani Siqueira

---

## 1. Arquitetura

```
 Navegador (SPA em JavaScript puro)                     Servidor Node.js 20 (http nativo)
 ┌──────────────────────────────────────┐   HTTPS/JSON   ┌───────────────────────────────────────────┐
 │ index.html  ─ telas (rotas em hash)  │ ─────────────▶ │ server.js  ─ api(): rotas /api/*          │
 │ app.js      ─ estado, eventos, mapa  │                │            ─ arquivos estáticos (gzip)    │
 │ styles.css  ─ visual, 360 px, A5     │ ◀───────────── │            ─ /tiles (proxy de mapa)       │
 │ sw.js       ─ cache do shell (PWA)   │                │ lib/http.js      send/httpError/readBody  │
 │                                      │                │ lib/validate.js  str() e clean*()         │
 │ Leaflet + markercluster (unpkg+SRI)  │                │ lib/security.js  senhas, sessão, limites  │
 │ jsQR (unpkg+SRI, carregado sob demanda)                │ lib/osm.js       Overpass/opening_hours   │
 └──────────────────────────────────────┘                │ lib/time.js      America/Sao_Paulo        │
                │                                        │ db.js            sql.js + migração        │
                │ tiles (OSM/Esri)                       └───────────────┬───────────────────────────┘
                ▼                                                        │ grava de forma atômica
        servidores de mapa                  Overpass / Nominatim ◀───────┤
                                            (OpenStreetMap)              ▼
                                                              data/foodfind.db + data/uploads/
```

- **Sem framework**: o roteamento é feito em `api()` com comparação de `pathname`/método e expressões regulares, como no código-base da Sprint 3.
- **Banco em memória com persistência**: o `sql.js` (SQLite em WebAssembly) carrega o arquivo `foodfind.db` na inicialização; cada alteração (ou transação) é exportada e gravada de forma atômica.
- **Front-end sem handlers inline**: toda ação usa `data-action`/`data-form` com delegação de eventos. Isso permite uma CSP sem `unsafe-inline`.

### 1.1 Módulos do servidor

| Arquivo | Responsabilidade |
|---|---|
| `server.js` | Inicialização, segurança por requisição (cabeçalhos/CSRF), rotas da API, regras de negócio (avaliações, campanhas, vouchers, reivindicação, LGPD), estáticos, tiles, encerramento limpo (SIGTERM) |
| `db.js` | Esquema v5, migração de bancos 2.2/3 e v4, `all/get/run/tx`, gravação atômica, trava `foodfind.lock` |
| `lib/remote.js` | Opcional (`DATABASE_URL`): restaura e guarda no PostgreSQL a cópia do banco, as fotos e o cache do OSM |
| `lib/http.js` | `send`, `httpError`, `readBody` (limite de tamanho, JSON obrigatório), `sendFile` assíncrono com gzip e ETag |
| `lib/validate.js` | `str()`, `cleanUrl()` (só http/https), `cleanInstagram()`, `cleanPhone()`, `cleanHours()`, `cleanMenu()`, `cleanPhotos()` (só fotos do dono), `cleanRestaurant()` |
| `lib/security.js` | scrypt, token/hash de sessão, cookies, `RateLimiter`, CSP e cabeçalhos, verificação de origem, log sem dados sensíveis |
| `lib/osm.js` | Consulta Overpass (restaurantes, bares, cafés, padarias, sorveterias...), categorias, `opening_hours` → aberto agora, cache e índice de lugares vistos |
| `lib/time.js` | Conversão entre horário de São Paulo e UTC; aberto agora |

### 1.2 Telas (rotas em hash)

| Rota | Tela | Acesso |
|---|---|---|
| `#/` | Início: mapa, busca, filtros, lista | todos |
| `#/restaurante/:ref` | Perfil, avaliações, campanhas | todos |
| `#/painel` | Meus restaurantes e pedidos de reivindicação | Restaurante |
| `#/campanhas` | Gestão de campanhas, QR, validação de voucher | Restaurante |
| `#/beneficios` | Meus benefícios (vouchers) | Cliente |
| `#/conta` | Dados, senha, sair de todos, exportar, excluir | logado |
| `#/admin` | Visão geral, usuários, reivindicações e redefinição de senha | administrador |
| `#/privacidade`, `#/termos` | Textos legais | todos |

Rotas protegidas abrem o login e voltam para a tela pedida depois de entrar. O link `/?resgatar=CODIGO` é tratado na inicialização (ver seção 3).

---

## 2. Modelo de dados (esquema versão 5)

```
users 1───* sessions          (ON DELETE CASCADE)
users 1───* restaurants        (owner_id, CASCADE)
restaurants 1───* campaigns    (CASCADE)
campaigns 1───* redemptions    (CASCADE)
users 1───* redemptions        (CASCADE)
users 1───* reviews            (CASCADE)        reviews.place_ref = "ff-12" | "node-123"
users 1───* claims             (CASCADE)        claims.restaurant_id → restaurants (SET NULL)
users 1───* uploads            (CASCADE)
```

| Tabela | Campos principais | Observações |
|---|---|---|
| `users` | id, name, email (único, minúsculo), password_hash (`salt:hash` scrypt), role (`cliente`/`restaurante`), created_at, updated_at, last_seen_at | Administrador = e-mail igual a `ADMIN_EMAIL`; `last_seen_at` atualizado no login e no máximo a cada 30 min |
| `sessions` | id, **token_hash** (SHA-256, único), user_id, created_at, expires_at | 30 dias; limpeza na inicialização e a cada hora |
| `restaurants` | id, owner_id, osm_ref (único, opcional), name, category, cuisine, description, website, phone, whatsapp, instagram, delivery_url, menu_url, price_range, address, lat, lng, hours (JSON), menu (JSON), photos (JSON) | `osm_ref` preenchido quando assumido do OSM |
| `reviews` | id, **place_ref**, place_name, user_id, rating (1–5), comment (≤ 600), created_at, updated_at | `UNIQUE(place_ref, user_id)` |
| `campaigns` | id, restaurant_id, **code** (secreto, único), title, description (obrigatória), discount_type (`percent`/`fixed`), discount_value, starts_at, ends_at (UTC), max_redemptions (NULL = sem limite), active, created_at, updated_at | Status calculado: agendada, ativa, pausada, encerrada, esgotada |
| `redemptions` | id (→ voucher `FF-000123`), campaign_id, user_id, **check_code**, status (`emitido`/`usado`), redeemed_at, used_at | `UNIQUE(campaign_id, user_id)` |
| `claims` | id, osm_ref, user_id, status (`pendente`/`aprovado`/`recusado`), data (JSON), message, reason, restaurant_id, created_at, decided_at, decided_by | Pedido para assumir restaurante do OSM |
| `uploads` | file (PK), owner_id, created_at | Dono de cada foto; base para apagar órfãs |
| `visits_daily` | day (PK, AAAA-MM-DD em São Paulo), visits | Só o total de visitas do dia; sem IP, cookie ou identificação |

Índices: sessões por usuário e expiração; restaurantes por dono; avaliações por lugar/data e por usuário; campanhas por restaurante; resgates por campanha e por usuário; pedidos por status e por lugar; fotos por dono.

### 2.1 Migração de bancos antigos
`db.init()` lê `PRAGMA user_version`. Se for menor que 4 e houver tabelas, `migrateLegacy()`:
1. renomeia as tabelas antigas para `legacy_*`;
2. cria o esquema atual (com chaves estrangeiras e índices);
3. copia usuários, restaurantes (registrando as fotos em `uploads`), avaliações (`restaurant_id` → `place_ref`), campanhas (código em maiúsculas; descrição vazia recebe o título) e resgates (gera código de conferência);
4. **descarta as sessões** (guardavam o token em texto puro) — os usuários só entram de novo;
5. apaga `legacy_*` e grava `user_version` da versão atual. Tudo dentro de uma transação.

Da versão 4 para a 5, `upgradeTo5()` acrescenta `users.last_seen_at` e a tabela `visits_daily`.

### 2.2 Gravação atômica e trava
`save()` exporta o banco, grava em `foodfind.db.<pid>.tmp`, faz `fsync` e `rename` sobre o arquivo final (no Windows, se o antivírus travar o rename, copia e remove o temporário). O servidor cria `foodfind.lock` ao iniciar e o remove ao receber SIGTERM/SIGINT; o `npm run seed` se recusa a rodar enquanto a trava estiver ativa, porque o servidor mantém o banco em memória e sobrescreveria as alterações.

### 2.3 Persistência externa (PostgreSQL)
Em hospedagens com disco temporário (Render gratuito), `DATABASE_URL` liga o `lib/remote.js`:
- **Início**: `db.init()` chama `remote.restore()`, que cria (se preciso) as tabelas `foodfind_snapshot` (cópia do banco, 1 linha) e `foodfind_files` (fotos e `osm-cache.json`), grava esses arquivos na pasta de dados e **assume** a cópia (coluna `owner`). Se o PostgreSQL não responder, o erro interrompe a inicialização.
- **Alterações**: cada `save()` agenda o envio do banco exportado (o mais recente vence; envios em sequência) e sincroniza a pasta `uploads`. O envio só vale se este processo ainda for o `owner`; senão, ele para de gravar (deploy novo assumiu).
- **Encerramento**: no SIGTERM o servidor espera a última cópia chegar (até 15 s). O seed também espera antes de sair.
- O endereço do banco não aparece em log.

---

## 3. Fluxo do QR Code e do voucher

```
Dono                          Servidor                                   Cliente
 │ POST /api/my/campaigns ───▶ valida (título, benefício, desconto,       │
 │                             período em America/Sao_Paulo, limite)      │
 │                             code = 16 caracteres de crypto.randomBytes │
 │ GET  .../qr.svg ──────────▶ QRCode.toString("{PUBLIC_URL}/?resgatar=code", svg)
 │ imprime cartaz A5 e deixa no balcão                                    │
 │                                                                        │ câmera do celular lê o QR
 │                                                                        │ abre /?resgatar=CODE
 │                             front guarda o código (sessionStorage),    │
 │                             limpa a URL; sem login → abre o login      │
 │                             POST /api/campaigns/redeem {code} ◀────────│
 │                             1. logado? (401)  2. Cliente? (403)        │
 │                             3. código informado? (400)                 │
 │                             4. bloqueio por erros seguidos? (429)      │
 │                             5. existe? (404)  6. encerrada? (410)      │
 │                             7. pausada? (423) 8. começou? (409)        │
 │                             9. já resgatou? (409) 10. vagas? (409)     │
 │                             INSERT redemptions (transação) ───────────▶│ comprovante: restaurante,
 │                                                                        │ benefício, validade,
 │                                                                        │ FF-000123 + código de conferência
 │ GET  /api/my/vouchers/FF-000123  (status, cliente "Carla S.")          │ mostra no caixa
 │ POST /api/my/vouchers/FF-000123/use {checkCode} ─▶ confere código,     │
 │                             status emitido → usado (UPDATE ... WHERE status='emitido')
 │                             2ª tentativa → 409 voucher_used            │
```

- O código **nunca** sai em rotas públicas: a lista pública (`/api/restaurants/:ref/campaigns`) devolve só `id, title, benefit, discountType, discountValue, discountLabel, startsAt, endsAt, validUntil, hasSlots`. Um teste automatizado percorre as rotas públicas, como visitante e como cliente, procurando o código.
- O QR é servido com `Cache-Control: private, no-store` e só para o dono (`404` para outros donos, `401` sem login).
- Leitura no navegador: `BarcodeDetector` quando o navegador suporta `qr_code` (Chrome Android); caso contrário, `jsQR` (carregado do unpkg com SRI) lendo quadros de um `<canvas>`. Sempre há o campo para digitar o código (aceita o link inteiro, letras minúsculas e hífens).
- Se o código vazar, o dono usa **Gerar novo código**; o anterior deixa de valer.

---

## 4. Decisões de segurança

| Ameaça | Medida |
|---|---|
| Resgate sem estar no restaurante | Código só no QR impresso; nunca em rotas públicas; novo código sob demanda |
| Força bruta de código | 80 bits de entropia + bloqueio após 10 códigos inválidos em 15 min por usuário |
| Voucher inventado (número sequencial) | Código de conferência aleatório de 4 caracteres conferido pelo dono; tentativas erradas limitadas |
| Roubo de sessão no banco | Banco guarda só o SHA-256 do token; cookie `HttpOnly`, `SameSite=Lax`, `Secure` em HTTPS |
| Fixação de sessão | Rotação: login e cadastro apagam a sessão anterior do navegador |
| Força bruta de senha | 5 erros por e-mail → bloqueio de 15 min; 20 tentativas por IP em 15 min; scrypt |
| Enumeração de contas | Login responde "E-mail ou senha incorretos." nos dois casos, com tempo equivalente |
| XSS | CSP sem `unsafe-inline`; todo texto passa por `escapeHtml`; URLs externas por `cleanUrl` (só http/https, sem credenciais) |
| CSRF | Alterações exigem `Content-Type: application/json` e origem do próprio site (`Origin`/`Sec-Fetch-Site`) |
| Clickjacking | `X-Frame-Options: DENY` e `frame-ancestors 'none'` |
| CDN comprometido | SRI (SHA-384) em Leaflet, markercluster e jsQR; fontes servidas localmente |
| Upload malicioso | Magic bytes JPG/PNG/WEBP, extensão definida pelo conteúdo, 5 MB, `nosniff`, nome aleatório (UUID) |
| Uso de fotos de outro dono | `cleanPhotos` aceita só arquivos registrados para o próprio usuário |
| Abuso de geocode/tiles | Exigem origem do próprio site, limite por IP e cache |
| Diagnóstico exposto | `/api/map-check` só para administrador ou modo dev |
| Tomada de restaurante real | Reivindicação com aprovação do administrador; pendente não é editável |
| Vazamento em logs | `logError` não registra corpo de requisição, cookies, senhas, tokens ou códigos |
| Queda do servidor | Erros tratados por requisição; `uncaughtException`/`unhandledRejection` registrados sem derrubar o processo |
| Path traversal | `path.resolve` + verificação de prefixo; arquivo inexistente com extensão → 404 |

### 4.1 Privacidade (LGPD)
- Localização: só após aviso de consentimento e permissão do navegador; enviada apenas na busca; não é armazenada.
- Minimização: avaliações mostram o nome abreviado ("Pedro A."); o dono vê o cliente do voucher também abreviado.
- Direitos do titular: exportação (JSON) e exclusão em cascata pelo próprio usuário; edição do nome.

---

## 5. Testes

- `npm test` = `node --test`: seis arquivos em `test/`, cada um sobe `node server.js` em porta livre (`PORT=0`), com pasta de dados temporária (`FOODFIND_DATA_DIR`) e um simulador local de Overpass/Nominatim (`FOODFIND_OVERPASS_URL`/`FOODFIND_NOMINATIM_URL`).
- O cliente de teste guarda o cookie como um navegador e chama a API por HTTP. Nenhum teste copia funções do código: todos exercitam o servidor real.
- 78 casos de teste em 8 suítes (o runner também conta o arquivo de apoio `test/_helpers.js`). A suíte de persistência (4 casos) precisa de um PostgreSQL em `FOODFIND_TEST_DATABASE_URL`; sem ela, é pulada e ficam 74 casos.
- O GitHub Actions roda `npm ci` + `npm test` no Node 20 e constrói/sobe a imagem Docker esperando o healthcheck.

---

## 6. Implantação

- **Docker**: `node:20-alpine`, `npm ci --omit=dev`, usuário `node` (uid 1000), `HEALTHCHECK` em `/api/health`, volume nomeado `foodfind-data` em `/app/data`.
- **Variáveis**: `PORT`, `PUBLIC_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `FOODFIND_DATA_DIR`, `FOODFIND_BACKUP_DIR`, `TRUST_PROXY` (ver README).
- **HTTPS**: necessário para a câmera fora de `localhost`. Use um proxy reverso (Caddy/Nginx) ou um serviço de hospedagem com TLS e defina `TRUST_PROXY=1` e `PUBLIC_URL`.
- **Backup**: `npm run backup` (ou `docker compose exec foodfind npm run backup`).
