# FoodFind 4.0.0 — Roteiro do vídeo (até 15 minutos)

**Apresentadores:** Pedro Augusto Dantas Aranda (P) e Vinicius Tofani Siqueira (V)
**Preparação:** servidor rodando com `npm run seed` aplicado e `ADMIN_EMAIL=admin@foodfind.local`; navegador em 1280 px e um celular (ou o modo dispositivo do navegador em 360 px); cartaz A5 da campanha "15% no almoço executivo" impresso ou aberto em outra tela; terminal com `npm test` pronto.

| Bloco | Tempo | Acumulado |
|---|---|---|
| 1. Contexto | 2:00 | 2:00 |
| 2. Negócio | 2:30 | 4:30 |
| 3. Plano de teste | 2:30 | 7:00 |
| 4. Demonstração | 6:30 | 13:30 |
| 5. Conclusão | 1:30 | 15:00 |

---

## 1. Contexto — 2:00 (P)
**Tela:** slide de abertura → página inicial do FoodFind.
- (0:00–0:30) Apresentação: FATEC Ipiranga, ADS Noturno, Laboratório de Engenharia de Software, Prof. Veríssimo; integrantes.
- (0:30–1:15) Problema: quem está na rua não sabe quais restaurantes estão perto, abertos e bem avaliados; restaurantes pequenos não têm um canal simples para divulgar promoções e medir o retorno.
- (1:15–2:00) Proposta: web app (instalável como PWA) que junta dados públicos do OpenStreetMap com o cadastro feito pelo próprio restaurante, avaliações dos clientes e descontos resgatados por QR Code **no local**.

## 2. Negócio — 2:30 (V)
**Tela:** slide com os atores e as histórias.
- (2:00–2:45) Atores: Cliente, Restaurante (dono), Administrador.
- (2:45–3:45) Histórias de usuário principais: HU1 conta e login; HU2.1 busca/mapa/filtros; HU2.2 avaliações; HU3.2 campanhas; HU3.3 QR Code; HU3.4 resgate e voucher; HU4.1 painel do restaurante; reivindicação de restaurante do mapa.
- (3:45–4:30) Regras de negócio que importam: uma avaliação por cliente; o código da campanha é secreto (só no cartaz do restaurante); cada cliente resgata uma vez; voucher usado uma única vez e conferido pelo número + código; campanha com início, fim e limite; dono só assume restaurante do mapa com aprovação.

## 3. Plano de teste — 2:30 (P)
**Tela:** PDF `docs/plano-de-teste.pdf` → terminal.
- (4:30–5:15) Escopo e estratégia: testes de API/integração automatizados com `node:test` que sobem o **servidor real** com banco temporário e OpenStreetMap simulado; testes de interface e de dispositivo como homologação manual.
- (5:15–6:00) Matriz: mostrar alguns casos (CT de resgate com todos os erros, CT do segredo do código, CT de cascata) com pré-condições, passos, resultado esperado e critério de aceitação.
- (6:00–7:00) **Rodar `npm test` ao vivo**: mostrar o final `# pass 70 / # fail 0` (69 casos + arquivo de apoio). Mostrar o GitHub Actions verde (aba *Actions* do repositório).

## 4. Demonstração — 6:30 (V conduz, P narra)
Seguir o [roteiro de demonstração](roteiro-demonstracao-e-homologacao.md). Pontos e tempos:
- (7:00–7:45) **Visitante**: aviso de localização → permitir; mapa com pins agrupados e nota; filtro "Padaria" e "Aberto agora"; busca por endereço "Vila Mariana"; "Buscar nesta área".
- (7:45–8:30) **Perfil** da Cantina Bella Paulista: fotos, horário, cardápio, avaliações com distribuição, campanha pública **sem código**; mostrar a URL `#/restaurante/ff-1` e dar F5.
- (8:30–9:30) **Cliente** (`cliente@foodfind.local`): editar a própria avaliação (formulário preenchido); avaliar um restaurante do OpenStreetMap.
- (9:30–10:45) **Dono** (`restaurante@foodfind.local`): Campanhas e vouchers → status das 3 campanhas; criar campanha (mostrar erro sem descrição); abrir **QR Code** → imprimir cartaz A5 / baixar SVG.
- (10:45–12:00) **Resgate no celular**: ler o QR do cartaz com a câmera → login do cliente → **comprovante FF-…**; tentar de novo → "Você já resgatou". Mostrar a campanha pausada (Sushi) → "pausada".
- (12:00–12:45) **Validação no caixa**: dono digita o número e o código de conferência → "Voucher validado"; repetir → "já foi usado".
- (12:45–13:30) **Admin + LGPD**: restaurante2 pede para assumir um lugar do mapa → admin aprova; cliente exporta os dados (JSON) e mostra "Excluir minha conta" (sem confirmar).

## 5. Conclusão — 1:30 (P e V)
- (13:30–14:15) Entregas: Sprint 3 completa, segurança (CSP, SRI, sessões com hash, limites, CSRF), LGPD, PWA, Docker não-root com healthcheck, CI, documentação.
- (14:15–14:45) Limitações honestas: depende do OpenStreetMap; câmera exige HTTPS; sem envio de e-mail (redefinição pelo administrador).
- (14:45–15:00) Próximos passos: notificações, pedidos online, painel de métricas para o dono. Agradecimento.

### Dicas de gravação
- Deixe o navegador com zoom de 110% para leitura no vídeo.
- Use duas janelas lado a lado (dono × cliente) no bloco de resgate.
- Se a internet falhar, a busca mostra só os restaurantes cadastrados (o seed tem 3) — a demonstração continua.
