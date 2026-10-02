# ORBITA backend

API de orquestração logística: pedidos independentes entram no pool; o matching tenta inseri-los em rotas existentes antes de formar novas rotas. Implementação local funcional com adapters de desenvolvimento para mapas e WhatsApp.

## Stack e arquitetura

Node 22.12+/24, NestJS 11, TypeScript estrito, Prisma 6.19, PostgreSQL/PostGIS, Redis 7.4, BullMQ, Socket.IO, JWT, class-validator, Swagger, Jest e Supertest. Use o lockfile (`npm ci`).

Módulos: `auth`, `businesses`, `drivers`, `tracking`, `deliveries`, `routes`, `matching`, `pricing`, `offers`, `maps`, `messaging`, `whatsapp`, `finance`, `incidents`, `analytics`, `admin`, `service-zones`, `jobs`, `realtime`, `users` e infraestrutura compartilhada. Controllers delegam as operações aos serviços.

- [Auditoria, arquitetura e plano das fases](docs/architecture.md)
- [OpenAPI exportado](docs/openapi.json)
- [Resultados e limites de validação](docs/validation.md)
- [Configuração de exemplo](.env.example)

## Branches

- `codex/production`: versão de referência para preparação de releases.
- `codex/development`: desenvolvimento e integração das próximas alterações.

As duas branches começam no mesmo commit validado. A publicação do código no GitHub não executa implantação nem ativa integrações externas. Para promover alterações, revise e valide o conteúdo de desenvolvimento antes de incorporá-lo à branch de produção.

## Primeira execução

```sh
npm ci
npm run setup:env
docker compose up -d --wait
npm run prisma:generate
npm run db:migrate
npm run db:seed
npm run build
```

Em dois terminais:

```sh
npm start
```

```sh
npm run worker
```

API: `http://localhost:3000/api/v1`. Swagger interativo: `http://localhost:3000/api/docs`.

`npm run start:dev` usa watch e TypeScript com metadata de decorators. Reinicie também o worker depois de alterar o código compilado.

`setup:env` gera segredos locais aleatórios e não sobrescreve um `.env` existente. A senha das contas de demonstração é o valor de `SEED_PASSWORD` nesse arquivo. Não publique `.env`; não use as credenciais locais do Compose em produção.

Contas do seed: `admin@orbita.example`, `business1@orbita.example` até `business3@orbita.example`, `driver1@orbita.example` até `driver10@orbita.example`. O seed cria 3 empresas, 5 unidades, 10 entregadores/veículos e 20 entregas em Goiânia/Aparecida. Reexecutá-lo preserva os registros existentes. Localizações e SLAs expiram normalmente; o simulador gera entregas novas e atualiza o GPS.

### Fallback usado nesta máquina Windows

O Docker Desktop instalado falhou ao iniciar seu socket de inferência. A validação foi feita com um cluster **isolado `14/orbita` no WSL Ubuntu**, PostgreSQL 14.24/PostGIS 3.2 e Redis 7.4.11, nas mesmas portas do Compose. O PostgreSQL 16 já existente no Windows não foi alterado. O Compose continua definindo PostgreSQL 16/PostGIS para um ambiente novo.

O script `scripts/dev-infra-wsl.sh` inicia o cluster e bancos `orbita`/`orbita_test` na porta `54432` e o Redis na porta `56379`. Requer PostgreSQL/PostGIS já instalados no WSL. Execute a partir da raiz do repositório:

```powershell
wsl -d Ubuntu -- bash ./scripts/dev-infra-wsl.sh
```

O Redis 7.4.11 foi compilado em `/opt/orbita/redis-7.4.11`; o script utiliza esse binário quando presente. Em outro ambiente, prefira o Compose ou instale Redis >=6.2 (recomendado 7.4). Não execute o Compose e o fallback nas mesmas portas simultaneamente.

A porta PostgreSQL foi alterada de `55432` para `54432` porque o Windows passou a reservar a faixa antiga para serviços de virtualização. O script atualiza somente a porta do cluster `orbita`, preservando os bancos existentes. Se ocorrer `EACCES` ao abrir uma porta no Windows, confira `netsh interface ipv4 show excludedportrange protocol=tcp`.

## Configuração

| Grupo | Variáveis e comportamento |
|---|---|
| Infra | `DATABASE_URL`, `REDIS_URL`, `PORT`, `CORS_ORIGINS` (lista separada por vírgula) |
| Auth | `JWT_SECRET`, `JWT_REFRESH_SECRET` diferentes, pelo menos 32 caracteres; access 900s e refresh 30 dias por padrão |
| Segredos | `PIN_PEPPER` e `OUTBOX_ENCRYPTION_KEY` (64 caracteres hexadecimais/AES-256). Preserve a chave enquanto houver mensagens pendentes |
| Tracking | `GPS_TTL_SECONDS`, `GPS_HISTORY_SAMPLE_SECONDS`, `GPS_RETENTION_DAYS` |
| SLA | `DEFAULT_PICKUP_SLA_SECONDS`, `DEFAULT_DELIVERY_SLA_SECONDS`, `DEFAULT_MAX_DELIVERY_SECONDS` |
| Matching | `MATCH_RADIUS_METERS`, `MATCH_CANDIDATE_LIMIT`, `MATCH_EVALUATION_LIMIT`, `MAX_POOL_BATCH`, `MAX_ROUTE_DELIVERIES` |
| Pool/ofertas | `OFFER_TTL_SECONDS`, `POOL_INTERVAL_SECONDS`, `SMART_POOL_WAIT_SECONDS`, `ECONOMY_POOL_WAIT_SECONDS`; EXPRESS não espera a janela de formação |
| Economia | `BASE_REVENUE_CENTS`, `BASE_PAYOUT_CENTS`, `MIN_DRIVER_CENTS_PER_KM`, `MIN_DRIVER_CENTS_PER_HOUR`, `MIN_PLATFORM_MARGIN_CENTS` |
| Score | `SCORE_ECONOMY_WEIGHT`, `SCORE_DRIVER_WEIGHT`, `SCORE_RELIABILITY_WEIGHT`, `SCORE_CAPACITY_WEIGHT`, `SCORE_SLA_WEIGHT`, `SCORE_DISTANCE_PENALTY`, `SCORE_TIME_PENALTY` |
| Espera | `WAIT_FREE_SECONDS`, `WAIT_FEE_CENTS_PER_MINUTE`; taxa registrada, aplicação financeira requer decisão administrativa |
| PIN | `PIN_MAX_ATTEMPTS`, `PIN_PROXIMITY_METERS` (zero desativa o requisito de proximidade) |
| Flags | `DYNAMIC_ROUTE_INSERTION_ENABLED`, `MULTI_PICKUP_ENABLED`, `WHATSAPP_ENABLED`, `REAL_PAYMENTS_ENABLED=false` |

Valores de dinheiro são centavos inteiros; distância em metros, duração em segundos, peso em gramas, volume em cm³. Datas são UTC e a unidade possui timezone. Configurações inválidas impedem startup. `REAL_PAYMENTS_ENABLED=true` também impede startup: **nenhum PIX ou pagamento externo está implementado**.

## Fluxo operacional

1. Cadastre `BUSINESS_OWNER` ou `DRIVER` em `POST /auth/register` e faça login. ADMIN não pode ser criado pelo cadastro público; use o seed local ou provisionamento administrativo controlado.
2. Empresa: `POST /businesses`, depois `POST /businesses/:id/branches`.
3. Entregador: registre veículo em `POST /driver/vehicles`, registre consentimento em `POST /driver/consent`. Admin aprova onboarding em `POST /admin/drivers/:id/review`. Altere status para AVAILABLE e envie GPS.
4. Crie entrega em `POST /deliveries`, opcionalmente com header `Idempotency-Key`. Ela entra em `WAITING_POOL` e `PREPARING`. `POST /deliveries/:id/ready` registra preparo concluído.
5. Worker filtra candidatos no PostGIS, testa inserções e cria ofertas. `GET /driver/offers` contém somente quantidade, pickup aproximado, distância, duração e ganho.
6. `POST /driver/offers/:id/accept` reserva atomicamente; `reject` recusa. Expiração automática devolve pedidos livres ao pool.
7. Driver inicia a rota; registra `arrive` e `complete` para pickups. Dropoffs exigem PIN ou confirmação do destinatário; `complete` genérico não contorna a prova.
8. `POST /deliveries/:id/verify` conclui entrega/prova/earning/ledger em uma transação. Depois de resolver todas as paradas, `POST /routes/:id/finish` encerra a rota.

Exemplo de entrega:

```json
{
  "branchId": "UUID-DA-UNIDADE",
  "customer": { "name": "João", "phone": "+5562999999999", "optIn": true },
  "dropoff": { "latitude": -16.681, "longitude": -49.251, "complement": "Casa 12" },
  "items": [{ "name": "X-Burger", "quantity": 2 }],
  "serviceLevel": "SMART",
  "capacityUnits": 10,
  "category": "HOT"
}
```

`estimatedReadyAt` permite planejar pedidos ainda em preparo; a coleta continua exigindo READY. Peso, volume, categoria, SLA, precedência de coleta e carga em cada trecho são verificados. O limite de tamanho de rota controla a complexidade computacional; não substitui capacidade física.

### PIN e acompanhamento

Com telefone e opt-in, o cliente recebe PIN e link por outbox. O PIN nunca aparece na resposta do motorista nem nos logs. Sem canal autorizado, a empresa pode usar `POST /deliveries/:id/customer-code` **antes da atribuição** para gerar o código e repassá-lo privadamente ao cliente. O endpoint não aceita DRIVER.

O link de confirmação guarda token no fragmento, exige um clique explícito e faz POST. `POST /deliveries/:id/tracking` com `{ "token": "..." }` retorna apenas status e ETA daquela entrega. Admin pode registrar confirmação excepcional com motivo em `/admin/deliveries/:id/confirm`; toda exceção é auditada.

### Cancelamentos e incidentes

Antes da coleta, cancelamento da empresa encerra o pedido; desistência do motorista libera-o para o pool. Depois da coleta, a carga permanece vinculada ao responsável e entra em `RETURN_REQUIRED`. `/deliveries/:id/return` inicia devolução e `/return/complete` exige confirmação administrativa da custódia. Incidentes aceitam tipo, notas e URLs HTTPS de anexos. Reatribuição administrativa em `/admin/deliveries/:id/reassign` preserva essas regras.

## GPS e WebSocket

`POST /driver/location` ou `/driver/heartbeat` aceita latitude, longitude, accuracy em metros, speed em metros/segundo, heading em graus e timestamp ISO8601. GPS operacional exige consentimento e AVAILABLE/ON_ROUTE. OFFLINE/PAUSED removem a presença operacional. Um heartbeat sem posição nova não renova uma posição antiga.

Redis mantém o snapshot com TTL. Worker persiste lotes e histórico amostrado; PostGIS é usado na seleção espacial. O sistema registra suspeitas de velocidade impossível sem banimento automático. Nenhuma busca percorre todos os motoristas na memória.

Socket.IO namespace `/operations`, autenticação `auth: { token: accessToken }`. Salas de driver/business/admin são atribuídas pelo backend. `route.subscribe` aceita `{routeId}` somente para o motorista responsável ou ADMIN. Empresas recebem projeções próprias em sua sala. `driver.location` aceita o mesmo DTO do HTTP e possui limite. Tokens expirados encerram o socket. Eventos carregam identificadores; consulte a API para obter a projeção autorizada atual.

API e worker podem estar em processos distintos; Redis Pub/Sub transporta as notificações de realtime. Após reconectar, o cliente deve consultar a API, pois Pub/Sub não oferece replay.

## WhatsApp

`MessagingProvider` possui `MockMessagingProvider` e `WhatsAppCloudProvider`. Por padrão não há envio externo. Para Meta, configure token, phone number ID, verify token, app secret, versão de API e `WHATSAPP_ENABLED=true`.

- Webhook: `GET/POST /api/v1/webhooks/whatsapp`.
- Assinatura HMAC SHA-256 validada sobre bytes originais; número receptor validado quando Cloud está habilitado.
- Inbox com unicidade por `externalMessageId`; reenvios retornam sucesso e não repetem criação.
- Identidade só opera após verificação/opt-in administrativos em `/admin/whatsapp-identities`, com referência de evidência. Alterar o telefone da empresa invalida a associação antiga.
- O despacho revalida vínculo, telefone, consentimento e conta ativa antes do envio. Revogação ou reassociação encerra mensagens antigas com `MESSAGE_AUTHORIZATION_REVOKED`; o PIN do cliente usa o consentimento da própria entrega.
- Conversa: `nova entrega` → filial (se houver várias) → nome → localização → complemento → itens. `pronto <id>`, `cancelar <id>`, `pedidos`, `saldo`, `suporte`; drivers usam botões ou `ACEITAR <id>`/`RECUSAR <id>`.
- Sessão criptografada com validade de 15 minutos. Comandos críticos são estruturados, sem IA.
- Fora da janela de atendimento de 24 horas, configure `WHATSAPP_NOTIFICATION_TEMPLATE`, um template `pt_BR` aprovado com um parâmetro de corpo para o texto operacional. Sem template, a mensagem fica em falha/retry visível no banco; não tenta burlar a janela.
- Mensagens são **at least once**. Timeout depois da aceitação pela Meta pode causar reenvio; ações internas permanecem idempotentes. Payload sensível é apagado após envio; retenção remove material antigo.

Os providers reais estão implementados, mas não foram chamados com credenciais reais nesta entrega. Aprovação dos templates, número da Meta e consentimento operacional dependem da configuração da sua conta.

## Mapas

`MAPS_PROVIDER=mock` usa distância geodésica ajustada e velocidade configurável. Serve à simulação, sem promessa de tempo real de trânsito. Produção recusa mock.

`MAPS_PROVIDER=google` usa Routes `computeRouteMatrix`, Geocoding e timeout. Configure `GOOGLE_MAPS_API_KEY` e habilite as APIs correspondentes. Matrizes são limitadas a 25 pontos/625 elementos; o domínio consome a abstração `MapsProvider`. O algoritmo local de inserção continua decidindo a ordem e as restrições. Não existe dependência da Google Route Optimization API.

## Filas, banco e financeiro

Execute API e worker. BullMQ programa manutenção, pool, expiração de ofertas e retenção. Outbox persistida junto do domínio permite retentar após falha. O PostgreSQL é a autoridade para reservas e saldo; Redis não decide quem ganhou uma oferta.

- `GET /health/live`: processo HTTP.
- `GET /health/ready`: PostgreSQL, PostGIS, Redis e estado da fila; confira também `queue.worker` (`up` ou `stale`).
- `GET /metrics`: métricas Prometheus, exige ADMIN.
- Dead letters: eventos com 20 tentativas, mensagens com 10, inbox com 8. Investigue a causa antes de rearmar; nunca repita a ação financeira diretamente.

Use `prisma migrate deploy`, nunca `db push` para implantação. Migrations incluem PostGIS, triggers de coordenadas, índices GiST, restrições de rota ativa/veículo e ledger. Alterações futuras precisam de migration nova.

Wallet deriva saldo da soma de lançamentos. Uma entrega gera débito da empresa, crédito do driver e margem da plataforma; gorjeta tem lançamento separado integral para o driver. Ledger é imutável e balanceado por trigger diferida, inclusive contra transações vazias. Ajustes administrativos exigem motivo e chave de idempotência. PREPAID/POSTPAID são campos preparados; bloqueio por saldo e integração de cobrança externa não estão ativados.

## Testes e simulação

```sh
npm run check
npm run test:integration
npm run simulate:drivers -- --deliveries=5 --steps=60 --interval=250
npm run docs:openapi
```

Integração usa **`orbita_test`**, com migrations aplicadas, e Redis DB 1. Configure `TEST_DATABASE_URL`/`TEST_REDIS_URL` para outros endereços. Exemplo PowerShell para preparar o banco de testes já criado:

```powershell
$env:DATABASE_URL='postgresql://orbita:orbita_local_only@localhost:54432/orbita_test?schema=public'
npm run db:migrate
Remove-Item Env:DATABASE_URL
npm run test:integration
```

No Compose, crie o banco uma vez com `docker compose exec postgres createdb -U orbita orbita_test`; habilite PostGIS como usuário administrativo antes de executar a migration se a conta de aplicação não possuir privilégio para extensões.

O simulador exige seed, ambiente não produtivo, mapas mock e WhatsApp desabilitado. Movimenta os drivers de demonstração, cria pedidos, aceita ofertas, executa paradas e verifica PINs. Retoma rotas de demonstração de runs anteriores; para PINs antigos não recuperáveis, registra confirmação administrativa simulada e auditada. Não executa entregas de empresas fora das contas de demonstração. O simulador chama os serviços da aplicação; os testes E2E também verificam a camada HTTP.

## Limites de implantação

O backend foi validado localmente; isto não substitui homologação operacional. Antes de publicar: configure mapas/Meta, TLS e domínio, segredos gerenciados, backups/restauração, limites de provedor, observabilidade e regras comerciais regionais. O Dockerfile está preparado, mas a imagem não foi construída nesta máquina devido à falha do Docker Desktop.

Documentos de onboarding, solicitações LGPD e zonas possuem estrutura; exclusão/anonymização de conta requer revisão de retenção financeira. Analytics e métricas são iniciais. Política de preço usa ambiente e não possui editor administrativo dinâmico. Não foram implementados previsão de demanda, ML, pagamento real, aplicativo companion ou dashboard visual, conforme o escopo de backend.
