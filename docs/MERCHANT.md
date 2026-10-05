# Operação do estabelecimento

O módulo `merchant` integra catálogo, pedido e entrega. Todas as operações exigem `BUSINESS_OWNER` ou `BUSINESS_STAFF` com estabelecimento ativo e usam o `businessId` da sessão; um identificador enviado pelo cliente nunca define a loja.

## API

- `GET/POST /api/v1/business/products`: catálogo da loja (até 500 itens), incluindo pausados. Nome, descrição opcional, categoria livre, `priceCents` inteiro positivo e `available`.
- `PATCH /api/v1/business/products/:id`: edição e pausa/ativação. Não apaga histórico.
- `GET /api/v1/business/orders`: mais recentes primeiro, cursor estável `(createdAt, id)`, limite padrão 25/máximo 100. Filtros `stage` e `search` (nome/telefone) são aplicados no banco antes da paginação. Etapas: `preparing`, `ready`, `on-the-way`, `completed`, `attention`, `cancelled`.
- `GET /api/v1/business/orders/:id`: produtos e preços históricos, cliente, endereço, notas internas do preparo e entrega vinculada sem PIN/hash/token privados.
- `GET /api/v1/business/orders/summary`: pedidos em preparo, prontos, em trânsito, entregues/cancelados hoje e catálogo. “Hoje” usa `America/Sao_Paulo`. `salesTodayCents` soma produtos dos pedidos criados hoje que não estão cancelados, falhos ou em devolução; não é receita recebida nem inclui frete.
- `POST /api/v1/business/orders`: exige `Idempotency-Key` de até 100 caracteres. Recebe filial, cliente, endereço textual, coordenadas confirmadas, itens `{productId, quantity}`, observações, modalidade, cuidados e preparo em minutos (0–120; padrão 15). Não aceita preços do cliente. Quantidade 1–100 por produto, até 100 produtos distintos e total até 2 bilhões de centavos.

A mesma transação serializável cria pedido, itens com nome/preço congelados, entrega, auditoria e outbox. Repetir a chave com o mesmo conteúdo recupera o pedido; conteúdo diferente retorna 409. Produto pausado ou de outra loja e filial inativa/externa são recusados. Alterar o catálogo não muda pedidos existentes. O frete continua no ledger logístico existente, separado do valor de mercadorias.

O pedido usa a máquina de estados da entrega. Preparo 0 cria a entrega pronta; nos demais casos o estabelecimento usa `POST /deliveries/:id/ready`. Matching, oferta, aceite, coleta, confirmação, cancelamento e devolução usam os fluxos existentes. O endereço textual e o complemento acompanham o entregador em `Delivery.complement`; `MerchantOrder.notes` fica como observação do preparo.

## Endereço

`POST /api/v1/business/addresses/search` recebe `{address}` e retorna até 5 candidatos com coordenadas e indicação de aproximação. Exige o Google Maps existente (`MAPS_PROVIDER=google`, `GOOGLE_MAPS_API_KEY` com Geocoding API habilitada). A chave permanece no servidor; 20 buscas/minuto por loja, timeout de 8 segundos, sem persistência de resultados nem registro de endereço em logs. A interface exige seleção explícita, pois resultado aproximado não confirma o número.

Com o provider de desenvolvimento, a busca retorna 503 e nunca fabrica coordenadas. A interface oferece confirmação manual de ponto copiado do mapa. Os links externos não são seguidos pelo servidor. A busca usa a [Geocoding API](https://developers.google.com/maps/documentation/geocoding/guides-v3/requests-geocoding), sujeita à configuração e às cotas da conta Google.

## Instalação e verificação

Aplicar `202610040001_merchant_catalog` com `npm run db:migrate`, gerar Prisma e compilar antes de iniciar API e worker. Reexportar OpenAPI e atualizar a cópia do frontend para liberar os novos endpoints no BFF.

`test/integration/merchant.spec.ts` verifica isolamento, validação, snapshots, concorrência/idempotência, paginação, filtros e transições. `src/maps/google-addresses.spec.ts` cobre candidatos, aproximações, erros e coordenadas inválidas. O worker deve permanecer ativo para distribuir as entregas.

Este módulo não cobra o cliente, não controla estoque numérico e não publica uma loja virtual; organiza o catálogo disponível e os pedidos operados pelo estabelecimento.
