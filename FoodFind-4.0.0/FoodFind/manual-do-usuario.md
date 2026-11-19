# FoodFind 4.0.0 — Manual do usuário

O FoodFind mostra restaurantes perto de você, com mapa, cardápio, fotos e avaliações, e permite resgatar descontos lendo o QR Code exposto no restaurante.

---

## Parte 1 — Cliente

### 1.1 Criar conta e entrar
1. Clique em **Criar conta** (canto superior direito).
2. Escolha **Cliente**, informe nome, e-mail e uma senha de **pelo menos 8 caracteres**.
3. Marque **"Li e aceito os Termos de Uso e a Política de Privacidade"** e clique em **Cadastrar**.
4. Nas próximas vezes, use **Entrar**. Se errar a senha 5 vezes, o acesso daquele e-mail fica bloqueado por 15 minutos.
5. Esqueceu a senha? Peça ao administrador do FoodFind para redefini-la. Ele gera uma senha temporária; depois troque-a em **Minha conta**.

### 1.2 Encontrar restaurantes
- Na primeira visita aparece um aviso sobre a localização. Clique em **Usar minha localização** e permita no navegador, ou em **Prefiro digitar um endereço**.
- **Buscar por nome, prato ou culinária**: digite no campo principal (ex.: "pizza", "temaki") e clique em **Buscar**.
- **Buscar por endereço ou bairro**: digite no campo "Ou pesquise por endereço ou bairro", clique em **Buscar endereço** e escolha um dos resultados. Use esta opção também se a permissão de localização for negada.
- **Filtros e ordenação**: categoria, faixa de preço, nota mínima, distância (até 1, 2, 4, 6 ou 10 km), "Aberto agora" e ordenação (mais perto, melhor avaliados, nome). **Limpar filtros** volta ao padrão.
- **Mapa**: os números nos círculos agrupam vários restaurantes; aproxime para separá-los. O pin mostra a nota média (★4,5). Clique no pin para ver o resumo e **Ver perfil**. Ao arrastar o mapa, aparece **Buscar nesta área**.
- **Lista**: 10 resultados por vez; **Ver mais** carrega os próximos.

### 1.3 Perfil do restaurante
- Fotos (clique nas miniaturas), categoria, descrição, nota média e quantidade de avaliações, aberto/fechado agora, endereço, telefone, horário de hoje.
- Botões: **Visitar site**, **Pedir delivery**, **WhatsApp**, **Instagram**, **Cardápio completo**, **Como chegar** (quando o restaurante informou).
- Horário da semana (o dia de hoje fica destacado) e cardápio com preços.
- O endereço da página (ex.: `#/restaurante/ff-12`) pode ser compartilhado; o botão voltar e o F5 funcionam.

### 1.4 Avaliar
1. No perfil, em **Avaliações dos clientes**, escolha de 1 a 5 estrelas e, se quiser, escreva um comentário (até 600 caracteres).
2. Clique em **Enviar avaliação**. Você pode avaliar tanto restaurantes cadastrados quanto os que vêm do OpenStreetMap.
3. Cada pessoa tem **uma avaliação por restaurante**. Para mudar, clique em **Editar** (o formulário já vem preenchido) e em **Salvar alterações**. Para apagar, clique em **Excluir**.
4. As avaliações aparecem da mais recente para a mais antiga, 5 por página. Seu nome aparece abreviado (ex.: "Pedro A.").

### 1.5 Resgatar um desconto com QR Code
1. No restaurante, procure o cartaz do FoodFind com o QR Code.
2. Opção A: aponte a **câmera do celular** para o QR. O FoodFind abre; se você não estiver logado, entre ou crie a conta e o resgate continua sozinho.
3. Opção B: no FoodFind, toque em **Ler QR Code** (topo da tela) → **Abrir câmera** e aponte para o QR. Funciona no Chrome (Android), Safari (iPhone) e Firefox. A câmera exige conexão segura (HTTPS).
4. Opção C: digite o código impresso abaixo do QR (ex.: `FAX3-3QB8-WH49-HBUX`) e toque em **Resgatar**.
5. Aparece o **comprovante**: restaurante, benefício, validade, **número do voucher** (ex.: FF-000123) e **código de conferência**. Mostre no caixa.
6. Mensagens possíveis: código inválido, campanha ainda não começou (com a data de início), encerrada, pausada, esgotada, já resgatada por você.

### 1.6 Meus benefícios
Menu da conta → **Meus benefícios**: todos os vouchers com status **Emitido**, **Usado** ou **Expirado**. Toque em **Ver comprovante** para mostrar no caixa.

### 1.7 Minha conta e privacidade
Menu da conta → **Minha conta**:
- **Dados pessoais**: alterar o nome.
- **Trocar senha**: informe a atual e a nova (mín. 8). As outras sessões são encerradas.
- **Sair de todos os dispositivos**.
- **Exportar meus dados**: baixa um arquivo JSON com conta, avaliações e benefícios.
- **Excluir minha conta**: pede a senha e apaga definitivamente sua conta, avaliações e benefícios.

### 1.8 Instalar como aplicativo
No Chrome (Android): menu ⋮ → **Instalar app** / **Adicionar à tela inicial**. No Safari (iPhone): Compartilhar → **Adicionar à Tela de Início**.

---

## Parte 2 — Restaurante (dono)

### 2.1 Criar conta
Clique em **Criar conta**, escolha **Restaurante** e preencha os dados. Depois do cadastro, o **Painel do restaurante** abre automaticamente (também acessível pelo menu da conta → **Meu restaurante**).

### 2.2 Cadastrar o restaurante
1. No painel, clique em **+ Cadastrar restaurante**.
2. Preencha as seções:
   1. **Informações básicas**: nome (obrigatório), categoria, faixa de preço, culinária e descrição.
   2. **Site e contatos**: site (endereço http/https), telefone, WhatsApp, Instagram (@ ou link), delivery e cardápio em PDF/página.
   3. **Localização**: digite o endereço e clique em **Localizar no mapa**, use **Minha localização** ou clique no mapa. Arraste o marcador para ajustar. (Obrigatório.)
   4. **Fotos**: **Adicionar fotos** (JPG, PNG ou WEBP, até 12). A primeira é a capa; use **★ Capa** para trocar e **✕** para remover.
   5. **Horário de funcionamento**: por dia, com a opção "Fechado". **Copiar horário de segunda para todos os dias** agiliza.
   6. **Cardápio**: seção, nome, preço e descrição de cada item.
3. Clique em **Salvar restaurante**. As informações aparecem na busca na hora.
4. Para alterar: **Editar**. Para remover: **Excluir** (apaga também fotos, campanhas e vouchers).

### 2.3 Assumir um restaurante que já aparece no mapa
1. Abra o perfil do seu restaurante na busca (dados do OpenStreetMap).
2. Clique em **Pedir para assumir**. O formulário abre preenchido com os dados do mapa; complete e escreva uma mensagem que ajude o administrador a confirmar que você é o responsável (ex.: CNPJ, telefone do estabelecimento).
3. Clique em **Enviar pedido**. O pedido fica **Pendente** no painel e o restaurante **não pode ser editado** até a análise.
4. Aprovado: o restaurante passa para o seu painel e substitui a versão do mapa (as avaliações antigas continuam). Recusado: o motivo aparece no painel. Pedidos pendentes podem ser cancelados.

### 2.4 Campanhas de desconto
Menu da conta → **Campanhas e vouchers** (ou botão no painel).
1. **+ Nova campanha**: escolha o restaurante, título, **descrição do benefício** (obrigatória), tipo (percentual ou valor fixo), valor, **início e fim** (horário de Brasília) e, se quiser, **limite de usos** (em branco = sem limite).
2. **Salvar campanha**: o QR Code abre em seguida.
3. Cada campanha mostra o **status**: *Agendada* (ainda não começou), *Ativa*, *Pausada*, *Encerrada* (passou do fim) ou *Esgotada* (atingiu o limite), além de usos e vouchers validados.
4. Ações: **QR Code**, **Editar**, **Pausar/Ativar**, **Vouchers** (lista dos resgates) e **Excluir** (apaga também os resgates).

### 2.5 QR Code e cartaz
- Em **QR Code** você vê o QR em tamanho grande, o código e o link de resgate.
- **Imprimir cartaz (A5)**: gera um cartaz com o nome do restaurante, o benefício, o QR, as instruções e a validade. Na janela de impressão, escolha papel A5 (ou A4 com "ajustar à página").
- **Baixar SVG**: arquivo vetorial para gráficas e materiais próprios.
- **Gerar novo código**: use se o código vazou; o QR antigo para de funcionar e é preciso imprimir o novo cartaz.
- O código é **secreto**: só aparece para você. Deixe o cartaz no restaurante para que só quem estiver no local possa resgatar.

### 2.6 Validar o voucher no caixa
1. Peça ao cliente o comprovante.
2. Em **Validar voucher do cliente**, digite o **número** (ex.: FF-000123) e clique em **Consultar**: aparece a campanha, o desconto, o cliente (nome abreviado) e o status.
3. Digite o **código de conferência** do comprovante e clique em **Confirmar uso do voucher**.
4. Aplique o desconto. O voucher só pode ser usado **uma vez**; uma nova tentativa mostra "já foi usado em…". Vouchers de campanhas encerradas não são validados.

---

## Parte 3 — Administrador
Disponível para a conta cujo e-mail está em `ADMIN_EMAIL`. Menu da conta → **Administração**.
- **Pedidos de reivindicação**: filtre por Pendentes/Aprovados/Recusados; confira o link do OpenStreetMap, o solicitante e a mensagem; **Aprovar** ou **Recusar** (com motivo).
- **Redefinir senha de um usuário**: digite o e-mail; uma senha temporária é mostrada uma única vez. Entregue ao usuário por um canal seguro.

---

## Problemas comuns
| Situação | O que fazer |
|---|---|
| "Permissão de localização negada" | Pesquise por endereço/bairro ou libere a localização nas configurações do navegador |
| O mapa aparece cinza | A rede pode bloquear os servidores de mapa; clique em **Tentar de novo**. A lista continua funcionando |
| A câmera não abre | A câmera só funciona em HTTPS; confira a permissão do navegador ou digite o código |
| "O OpenStreetMap não respondeu agora" | Aparecem só os restaurantes cadastrados; tente mais tarde |
| "Muitas tentativas" | Aguarde o tempo indicado na mensagem |
