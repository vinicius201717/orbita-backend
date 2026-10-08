# Contrato do aplicativo do entregador

O aplicativo nativo usa a API NestJS diretamente, com HTTPS e `Authorization: Bearer <accessToken>`. Não usa a sessão Redis/BFF do frontend web. O backend continua sendo a autoridade de disponibilidade, custódia, sequência das paradas e saldo. Os endpoints abaixo usam o prefixo `/api/v1`.

## Acesso e localização

| Operação             | Contrato                                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entrar               | `POST /auth/login` com `{email,password}` retorna `{accessToken,refreshToken,expiresIn,tokenType}`.                                                                                               |
| Perfil autenticado   | `GET /auth/me` retorna papel e `driverId`; o aplicativo aceita somente `DRIVER`.                                                                                                                  |
| Renovar sessão       | `POST /auth/refresh` com `{refreshToken}` retorna um novo par de tokens. A renovação deve ser serializada e os dois tokens substituídos juntos: reutilizar o token antigo revoga a família.       |
| Sair                 | `POST /auth/logout` com bearer e `{refreshToken}` revoga a família de renovação. O app apaga os tokens locais. Logout não abandona carga nem encerra uma rota.                                    |
| Perfil operacional   | `GET /driver/me`: aprovação, veículos, consentimento, status, rota e presença.                                                                                                                    |
| Consentimento GPS    | `POST /driver/consent` com `{granted:boolean}`. Revogação remove presença e bloqueia novas ofertas; uma rota já atribuída continua sob custódia do motorista.                                     |
| Ativar/parar ofertas | `PATCH /driver/availability` com `{acceptingOrders:boolean}`. Retorna o estado atualizado do motorista.                                                                                           |
| Enviar GPS           | `POST /driver/location` (ou `/driver/heartbeat`) com `{latitude,longitude,timestamp,accuracy?,speed?,heading?}`. `timestamp` ISO-8601, `accuracy` em metros, `speed` em m/s e `heading` em graus. |

O dispositivo precisa de permissão de localização além do consentimento da API. Ativar exige motorista aprovado, consentimento e veículo ativo. A API aceita GPS com status `AVAILABLE` ou `ON_ROUTE`; a pausa de novas ofertas durante uma rota mantém `ON_ROUTE` e GPS. Sem rota, parar muda para `PAUSED` e remove a presença. `OFFLINE` com rota continua proibido. A presença depende da persistência em lote pelo worker e expira conforme `GPS_TTL_SECONDS` (90 segundos por padrão); timestamps antigos e regressões são recusados. O app deve mostrar erro de permissão/rede em vez de representar uma localização não enviada como atual.

Ao ativar durante uma rota, o estado é `ON_ROUTE` e `acceptNewOrders:true`; parado durante uma rota, `ON_ROUTE` e `acceptNewOrders:false`. Matching e aceite de ofertas verificam esse último campo, inclusive novamente dentro da transação. Finalizar a rota preserva a escolha: pausado permanece pausado, sem retomar ofertas automaticamente. O endpoint legado `PATCH /driver/me/status` também interpreta `PAUSED` durante uma rota como pausa de novas ofertas.

## Resumo para a tela inicial

`GET /driver/summary` é restrito ao motorista autenticado e envia `Cache-Control: no-store`. Não aceita um `driverId` do cliente. Retorna:

```json
{
  "driver": {
    "id": "uuid",
    "status": "ON_ROUTE",
    "acceptNewOrders": false,
    "onboardingStatus": "APPROVED",
    "locationConsentAt": "2026-10-06T12:00:00.000Z",
    "presence": "FRESH"
  },
  "wallet": { "balanceCents": 1250, "currency": "BRL" },
  "today": {
    "date": "2026-10-06",
    "timeZone": "America/Sao_Paulo",
    "earningsCents": 1250,
    "completedDeliveries": 2
  },
  "currentRoute": {
    "id": "uuid",
    "status": "ACTIVE",
    "version": 3,
    "remainingStops": 1,
    "totalStops": 2,
    "remainingDeliveries": 1,
    "driverPayoutCents": 500
  },
  "nextStop": {
    "id": "uuid",
    "deliveryId": "uuid",
    "type": "DROPOFF",
    "status": "PENDING",
    "sequence": 1,
    "latitude": -16.68,
    "longitude": -49.25,
    "estimatedArrivalAt": null,
    "title": "Nome do destinatário",
    "address": "Rua do cliente, 100",
    "readinessStatus": "READY_FOR_PICKUP",
    "deliveryStatus": "IN_TRANSIT",
    "navigation": {
      "googleMapsUrl": "https://www.google.com/maps/dir/?api=1&destination=-16.68%2C-49.25",
      "wazeUrl": "https://waze.com/ul?ll=-16.68%2C-49.25&navigate=yes"
    }
  }
}
```

`currentRoute` e `nextStop` podem ser `null`; uma rota pode estar atribuída com todas as paradas resolvidas e `nextStop:null` até o motorista finalizá-la. `nextStop.address` pode ser `null` para entregas antigas sem endereço textual. Coletas mostram estabelecimento/filial e endereço da filial; entregas mostram destinatário e endereço/complemento. Não são retornados PIN, hash, token privado de confirmação nem dados de outra rota.

`wallet.balanceCents` é o total líquido dos lançamentos contábeis, incluindo ajustes. `today.earningsCents` soma repasse e gorjeta das entregas liquidadas no dia em `America/Sao_Paulo`; `completedDeliveries` usa a data real de conclusão da entrega no mesmo fuso. O intervalo inclui meia-noite inicial e exclui a meia-noite seguinte. Valores de rota/oferta são previstos, separados do saldo já lançado. Não há saque, cobrança ou integração de pagamento real neste contrato.

## Ofertas e execução da entrega

- `GET /driver/offers`: ofertas pendentes e não expiradas, com quantidade, distância/duração adicionais, repasse e coleta aproximada; não revela destinatários antes do aceite.
- `POST /driver/offers/:id/accept` retorna `routeId`; `POST /driver/offers/:id/reject` recusa. Uma oferta pode expirar ou tornar-se inviável; em 409, atualizar a tela. Parar ofertas bloqueia o aceite mesmo que a oferta já esteja visível.
- `GET /routes/:id`: rota autorizada, entregas projetadas sem segredos, paradas em ordem e links de navegação. `GET /routes` lista as rotas do próprio motorista.
- `POST /routes/:id/start`: inicia rota atribuída.
- `POST /routes/:id/stops/:stopId/arrive`: registra chegada à próxima parada.
- `POST /routes/:id/stops/:stopId/complete`: conclui coleta após chegada e estabelecimento marcar o pedido pronto. Não conclui entrega ao destinatário.
- `POST /deliveries/:id/verify` com `{code,latitude?,longitude?}`: PIN de quatro dígitos informado pelo destinatário, após a coleta; liquidação e comprovação são atômicas. Nunca mostrar ou inventar esse PIN no aplicativo.
- `POST /routes/:id/finish`: somente após todas as entregas/paradas resolvidas e carga zerada.
- `POST /deliveries/:id/incidents` permite registrar ocorrência; `/deliveries/:id/cancel` e `/return` seguem as regras existentes de custódia. O aplicativo deve encaminhar problemas para esse fluxo, sem simular conclusão.
- `GET /driver/wallet` retorna saldo e extrato com cursor; `GET /driver/earnings` lista repasses/gorjetas por entrega. O resumo agrega o dia inteiro independentemente dessas páginas.

O Socket.IO existente usa o namespace `/operations`, `auth:{token:accessToken}` e sala do próprio motorista. GPS pode ser enviado em `driver.location`, com o mesmo payload HTTP. A conexão expira com o access token; após renovar, reconectar com o token atual. Polling HTTP com atualização após mutações também é suportado.

## Verificação

`test/integration/driver-mobile.spec.ts` usa contas e entregas isoladas no banco de testes, lança saldos pela liquidação/ledger real, verifica as duas bordas do dia local e compara outro motorista. O ciclo de rota cobre pausa, GPS, exclusão do matching, recusa de oferta, próxima parada, coleta, PIN, saldo e finalização mantendo pausa. Não cria acessos de produção. Os fluxos de logística e autenticação existentes continuam cobertos pelas suítes `logistics.spec.ts` e `auth-tracking.spec.ts`.

Nenhuma migração nova é necessária. Após compilar, reinicie API e worker. Os contratos OpenAPI ficam em `docs/openapi.json`.
