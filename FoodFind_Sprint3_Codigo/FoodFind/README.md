# FoodFind (versão 2.2)

Web app para encontrar restaurantes próximos, com painel para os próprios restaurantes cadastrarem e atualizarem suas informações.

## Novidades da 2.2
- **Banco de dados SQLite** (arquivo `data/foodfind.db`). Contas, sessões de login e restaurantes ficam salvos no servidor, e não mais no navegador.
- **Senhas criptografadas** (scrypt) e login por cookie de sessão (fica logado por 30 dias).
- **Tipo de conta**: *Cliente* ou *Restaurante*.
- **Painel do restaurante** (botão "🏪 Meu restaurante" no topo, só para contas Restaurante):
  - nome, categoria, culinária, faixa de preço e descrição;
  - **URL do site** para onde o botão "Visitar site" redireciona, além de telefone, WhatsApp, Instagram, link de delivery e link do cardápio;
  - **localização**: busca pelo endereço ou clique no mapa, com marcador arrastável;
  - **fotos** (até 12, a primeira é a capa), reduzidas no navegador antes do envio;
  - **horário de funcionamento** por dia da semana, com indicação de "Aberto agora" no perfil;
  - **cardápio** com seções, itens, descrição e preço.
- **Restaurantes que já aparecem no mapa** (OpenStreetMap): o dono abre o perfil e clica em **"Assumir e editar"**. A partir daí a lista mostra a versão atualizada no lugar da original. Se o restaurante for cadastrado do zero com o mesmo nome e a menos de 150 m de um que já existe no mapa, o original também é substituído.
- Restaurantes novos, que não existiam no OpenStreetMap, passam a aparecer na busca (raio de 4 km).
- A busca também procura por itens do cardápio (ex.: "temaki").
- **Lista lateral paginada**: mostra 10 restaurantes e um botão **"Ver mais"** que carrega mais 10 a cada clique. O mapa mostra os mesmos restaurantes da lista. Os cadastrados aparecem com um marcador vermelho com estrela.

## Rodar localmente
Precisa do **Node.js 18 ou mais novo**.
```bash
npm install
npm start
```
Abra http://localhost:3000

## Docker
```bash
docker compose up --build
```
A pasta `data/` é montada como volume, então o banco e as fotos não se perdem.

## Onde ficam os dados
```
data/
├── foodfind.db    ← banco SQLite (usuários, sessões e restaurantes)
└── uploads/       ← fotos enviadas pelos restaurantes
```
A pasta é criada sozinha na primeira execução. Para ver ou editar o banco, abra o `foodfind.db` no [DB Browser for SQLite](https://sqlitebrowser.org/). Se você apagar a pasta `data/`, tudo volta do zero.

## Estrutura do projeto
```
server.js        ← servidor HTTP e rotas da API
db.js            ← conexão com o banco SQLite (sql.js) e criação das tabelas
public/
├── index.html   ← páginas: busca, perfil, painel do restaurante, login
├── app.js       ← lógica do front-end
└── styles.css   ← visual
```

## Rotas da API
| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/auth/register` | Cria conta (`name`, `email`, `password`, `role`) |
| POST | `/api/auth/login` | Entra na conta |
| POST | `/api/auth/logout` | Sai da conta |
| GET | `/api/auth/me` | Usuário logado |
| GET | `/api/restaurants?lat=&lng=&q=` | Busca (OpenStreetMap + cadastrados) |
| GET | `/api/restaurants/ff-:id` | Perfil de um restaurante cadastrado |
| GET/POST | `/api/my/restaurants` | Lista/cria restaurantes do dono logado |
| PUT/DELETE | `/api/my/restaurants/:id` | Edita/exclui um restaurante do dono |
| POST | `/api/uploads` | Envia uma foto |
| GET | `/api/geocode?q=` | Busca um endereço no mapa |

## Observações
- Contas criadas nas versões anteriores ficavam só no navegador (localStorage) e não foram migradas. É preciso criar a conta de novo.
- Os dados do OpenStreetMap podem ter campos incompletos. Se o OpenStreetMap estiver fora do ar, a busca mostra só os restaurantes cadastrados no FoodFind.
- A localização exata depende da permissão do navegador. Se ela for negada, o ponto inicial é São Paulo (Av. Paulista).

## Sprint 3 — avaliações e campanhas com QR Code

A versão da Sprint 3 adiciona:

- Avaliação de 1 a 5 estrelas para restaurantes cadastrados no FoodFind, com comentário opcional, média e quantidade de avaliações. Cada cliente mantém uma avaliação por restaurante; enviar novamente atualiza a anterior.
- Criação de campanhas por contas de restaurante proprietárias do estabelecimento, com desconto percentual ou fixo, datas de validade e limite de resgates.
- QR Code com código opaco da campanha. Clientes podem ler pelo botão de câmera (quando o navegador oferece `BarcodeDetector` e acesso à câmera) ou digitar o código manualmente.
- Resgate autenticado, com validação de validade, limite de usos e bloqueio de resgate duplicado por cliente.
- Testes automatizados básicos das regras de nota, desconto e período.

### Executar

Na pasta `FoodFind`:

```bash
npm install
npm test
npm start
```

Acesse `http://localhost:3000`. Para testar os fluxos, crie uma conta do tipo Restaurante, cadastre um restaurante com localização e crie uma campanha no perfil dele. Depois crie uma conta Cliente para enviar avaliações e resgatar ofertas. O QR Code usa um serviço externo de geração de imagem; a validação do código e do resgate é feita pelo servidor FoodFind. A leitura pela câmera depende das permissões do navegador e, fora de `localhost`, normalmente de HTTPS.
