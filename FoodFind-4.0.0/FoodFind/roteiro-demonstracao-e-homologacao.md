# FoodFind 4.0.0 — Roteiro de demonstração e checklist de homologação

## 1. Preparação do ambiente
```bash
npm install
cp .env.example .env            # ADMIN_EMAIL=admin@foodfind.local já vem preenchido
npm run seed -- --reset         # servidor parado
npm run start:env               # http://localhost:3000
```
Docker: `docker compose up --build -d`, depois `docker compose stop foodfind && docker compose run --rm foodfind npm run seed && docker compose start foodfind`.

Para ler o QR com a câmera de um celular, o FoodFind precisa estar em **HTTPS** (hospedagem com TLS ou túnel HTTPS) com `PUBLIC_URL` apontando para esse endereço. Em `localhost`, demonstre a leitura pelo próprio computador (webcam) ou digite o código.

### Contas do seed (senha de todas: `FoodFind@2026`)
| Conta | Tipo | O que tem |
|---|---|---|
| `admin@foodfind.local` | administrador | aprova reivindicações, redefine senhas |
| `cliente@foodfind.local` | cliente (Carla) | avaliações na Cantina e no Sushi |
| `cliente2@foodfind.local` | cliente (Bruno) | 1 voucher emitido na campanha ativa da Cantina |
| `restaurante@foodfind.local` | restaurante (Rafael) | Cantina Bella Paulista (campanha ativa + agendada) e Sushi Paraíso (campanha pausada) |
| `restaurante2@foodfind.local` | restaurante (Marina) | Padaria Pão da Augusta (campanha encerrada) |

---

## 2. Roteiro passo a passo

### 2.1 Visitante
1. Abrir `http://localhost:3000`. Mostrar o aviso de localização → **Usar minha localização** → permitir.
2. Mostrar o mapa: pins com nota, agrupamento, popup com resumo e **Ver perfil**.
3. Filtros: **Categoria = Padaria**; marcar **Aberto agora**; **Ordenar por = Melhor avaliados**; **Limpar filtros**.
4. Pesquisar o endereço **"Vila Mariana"** e escolher o resultado. Arrastar o mapa e clicar em **Buscar nesta área**.
5. Abrir **Cantina Bella Paulista**: fotos, horários, cardápio, avaliações (média, distribuição) e a campanha **"15% no almoço executivo"** — sem nenhum código visível.
6. Copiar a URL (`#/restaurante/ff-1`), dar **F5** e usar o botão **voltar** do navegador.
7. Clicar em **Ler QR Code** sem estar logado → abre o login.

### 2.2 Cliente
1. Entrar como `cliente@foodfind.local`.
2. No **Sushi Paraíso**, clicar em **Editar** na própria avaliação (formulário preenchido), mudar a nota e salvar; mostrar a média atualizada. Mostrar **Excluir** (opcional).
3. Abrir um restaurante do OpenStreetMap (sem o selo ✔) e avaliar com 5 estrelas.

### 2.3 Dono — campanhas e QR
1. Em outra janela (anônima), entrar como `restaurante@foodfind.local` → menu → **Campanhas e vouchers**.
2. Mostrar os status: **Ativa**, **Agendada** e **Pausada**, com usos e limite.
3. **+ Nova campanha** sem descrição → mensagem de erro; preencher a descrição → salvar → o QR abre.
4. No QR da campanha ativa: **Imprimir cartaz (A5)** e **Baixar SVG**.

### 2.4 Resgate
1. Com o celular, ler o QR do cartaz (ou, no computador, **Ler QR Code** → digitar o código mostrado no cartaz).
2. Se a sessão não estiver aberta no celular, entrar como `cliente@foodfind.local`: o resgate acontece automaticamente após o login.
3. Mostrar o **comprovante**: restaurante, benefício, validade, **FF-00000X** e código de conferência.
4. Tentar de novo → **"Você já resgatou esta campanha"**.
5. Usar o código da campanha **pausada** (Sushi, QR na conta do dono) → **"Campanha pausada"**; da **agendada** → **"ainda não começou"** com a data.
6. Menu → **Meus benefícios**: o voucher aparece como **Emitido**.

### 2.5 Validação no caixa
1. Na janela do dono, em **Validar voucher do cliente**, digitar o número do comprovante → **Consultar**.
2. Digitar um código de conferência errado → mensagem de erro. Digitar o correto → **Confirmar uso** → "Voucher validado".
3. Tentar de novo → "já foi usado em …". No cliente, **Meus benefícios** mostra **Usado**.
4. (Opcional) Validar o voucher do `cliente2` (número e código com `npm run seed -- --reset --detalhes`).

### 2.6 Reivindicação e administração
1. Entrar como `restaurante2@foodfind.local`, abrir um restaurante do mapa → **Pedir para assumir** → mensagem → **Enviar pedido**. Mostrar **Pendente** no painel.
2. Entrar como `admin@foodfind.local` → **Administração** → **Aprovar**. Voltar ao painel da Marina: o restaurante aparece e pode ser editado.
3. Em **Administração**, redefinir a senha do `cliente2@foodfind.local` (senha temporária).

### 2.7 Conta e LGPD
1. Como cliente: **Minha conta** → alterar o nome → **Exportar meus dados** (abrir o JSON).
2. Mostrar **Excluir minha conta** (pede a senha; não confirmar na demonstração, ou usar uma conta criada na hora).
3. Abrir **Política de Privacidade** e **Termos de Uso** no rodapé.

---

## 3. Checklist de homologação final

Marque cada item ao conferir no ambiente de homologação (navegador real, com internet).

### Instalação e infraestrutura
- [ ] `npm ci && npm test` → `# fail 0`
- [ ] `docker compose up --build -d` → `docker compose ps` mostra **(healthy)**
- [ ] Container roda como usuário não-root (`docker compose exec foodfind id -u` → `1000`)
- [ ] `docker compose down && docker compose up -d` → dados e sessões continuam
- [ ] `npm run backup` cria `backups/foodfind-AAAAMMDD-HHMMSS`
- [ ] GitHub Actions verde no último commit
- [ ] Repositório sem `node_modules/`, sem `data/`, sem `.db`, com `.gitignore`

### Busca e mapa
- [ ] Aviso de consentimento antes da localização; permitir → restaurantes próximos
- [ ] Permissão negada → mensagem e foco na busca por endereço
- [ ] Tiles do mapa carregam (algum provedor) e pins agrupam/desagrupam com o zoom
- [ ] Pin e popup mostram nota e quantidade de avaliações
- [ ] Filtros (categoria, preço, aberto agora, nota mínima, distância) e ordenação funcionam
- [ ] "Buscar nesta área" aparece ao arrastar e atualiza a lista
- [ ] Sem internet/OSM fora do ar → aviso e só os cadastrados

### Perfil e avaliações
- [ ] Fotos, horários (dia atual destacado), cardápio, botões de contato abrem em nova aba
- [ ] Nenhum link `javascript:`/`data:` em sites vindos do OSM
- [ ] Avaliar (cadastrado e OSM), editar com formulário preenchido, excluir
- [ ] Conta Restaurante não vê o formulário de avaliação
- [ ] Paginação "Mais antigas / Mais recentes"

### Campanhas, QR e voucher
- [ ] Criar campanha exige título e descrição; fim > início; limite opcional
- [ ] Status agendada/ativa/pausada/encerrada/esgotada corretos
- [ ] QR só na conta do dono; perfil público e código-fonte da página sem o código
- [ ] Cartaz A5 imprime em uma página; SVG baixa e abre
- [ ] Câmera lê o QR no **Chrome Android** (BarcodeDetector)
- [ ] Câmera lê o QR no **Safari iPhone** e no **Firefox** (jsQR)
- [ ] Link do QR sem login → login → resgate automático → URL limpa
- [ ] Todos os erros de resgate com mensagem própria
- [ ] Voucher validado uma única vez; código de conferência errado é recusado
- [ ] Meus benefícios mostra Emitido/Usado/Expirado

### Segurança
- [ ] 5 senhas erradas → bloqueio temporário com mensagem
- [ ] Cookie `ff_session` com HttpOnly/SameSite (e Secure em HTTPS) nas ferramentas do navegador
- [ ] Console do navegador sem violações de CSP
- [ ] Upload de arquivo que não é imagem → recusado

### Conta e LGPD
- [ ] Editar nome, trocar senha, sair de todos os dispositivos
- [ ] Exportar meus dados baixa JSON
- [ ] Excluir conta pede senha e remove os dados
- [ ] Páginas de Privacidade e Termos acessíveis no rodapé

### Acessibilidade e responsividade
- [ ] Navegação completa só com teclado (Tab, Enter, Espaço, ESC nos modais)
- [ ] Leitor de tela anuncia mensagens de status
- [ ] Layout em 360 px sem rolagem horizontal
- [ ] App instalável (PWA) no Android

**Responsáveis pela homologação:** ______________________  **Data:** ___/___/______
