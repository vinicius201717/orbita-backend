# ORBITA — pagamentos simples e credenciais

Revisado em 10/10/2026. Este documento define a próxima integração; ela **ainda não está implementada**. Hoje o sistema registra débitos do estabelecimento, ganhos do entregador e ajustes contábeis. Não cobra Pix, não transfere dinheiro e não concilia extratos bancários. Acrescentar uma chave não ativa essas funções: `REAL_PAYMENTS_ENABLED` deve continuar `false` até a implementação e homologação.

## Experiência proposta

O escopo inicial é cobrar o **serviço de entrega** do estabelecimento e pagar o entregador. O valor dos lanches/produtos continua sendo recebido pelo comércio pelos seus canais atuais; o total do pedido não deve ser confundido com receita de frete da ORBITA.

Como premissa provisória, reunir as entregas do dia em uma cobrança, com limite de uso por estabelecimento. O usuário ainda pode optar por créditos antecipados ou pagamento individual; a pergunta foi enviada, mas não houve resposta até esta revisão. Não liberar crédito ilimitado nem presumir que o motoboy já recebeu porque o ledger foi atualizado.

| Pessoa | Tela e ações principais | Comportamento esperado |
| --- | --- | --- |
| Estabelecimento | Total a pagar, entregas incluídas, **Pagar entregas**, histórico | Cobrança identificada; Pix com QR Code e copia e cola em checkout; cartão como alternativa se habilitado. Atualizar como pago somente após confirmação do provedor. |
| Motoboy | **A liberar**, **Disponível**, **Recebido**, data prevista | Cadastro bancário/verificação uma vez; repasse automático conforme disponibilidade e cronograma permitido. Mostrar falha e ação para corrigir dados. |
| Administração | Cobranças pendentes, repasses, falhas e conciliação | Consultar divergências, reprocessar com segurança e acompanhar estornos, sem fabricar comprovantes por ajuste contábil. |

Os estados são uma proposta de interface. O saldo contábil atual não pode ser simplesmente renomeado para “Disponível para saque”. Recebimento, liquidação, entrega concluída, retenções e repasse precisam ser relacionados no backend.

## Provedor recomendado

**Stripe Connect**, com checkout hospedado e cadastro de recebedor hospedado, é a recomendação para a primeira integração de cobrança e repasses. O catálogo de pagamentos do Vercel Marketplace consultado retornou Stripe; a lógica financeira deve continuar no backend NestJS. O catálogo existente de produtos da ORBITA não precisa ser migrado: estamos cobrando a logística.

A documentação do Stripe permite Pix com Connect, inclusive cobrança e transferência separadas. Isso permite associar uma cobrança de entregas a diferentes recebedores, desde que a configuração e a conta sejam elegíveis. Essa é uma proposta técnica, não confirmação de habilitação na conta do usuário. [Pix e Connect](https://docs.stripe.com/payments/pix), [cobranças e transferências separadas](https://docs.stripe.com/connect/separate-charges-and-transfers).

O onboarding hospedado coleta dados de verificação e da conta bancária; o app deve mostrar o estado de aprovação. Prazo e disponibilidade de repasse dependem da conta, método e país. **Pix recebido do estabelecimento não significa saque instantâneo por chave Pix para o motoboy.** [Cadastro hospedado](https://docs.stripe.com/connect/hosted-onboarding), [repasses](https://docs.stripe.com/connect/payouts-connected-accounts).

Se o requisito for especificamente **transferir para qualquer chave Pix do motoboy**, avaliar Asaas antes de escolher definitivamente o gateway. Ele documenta cobrança Pix e transferência para chave Pix, com acompanhamento por webhook. Não integrar dois gateways simultaneamente no primeiro piloto. Verificar aprovação da conta, modelo de operação, limites e tarifas no cadastro do provedor. [Cobrança Pix Asaas](https://docs.asaas.com/docs/pix), [transferências Pix Asaas](https://docs.asaas.com/docs/transferencia-para-contas-de-outra-instituicao-pix-ted).

Nenhum gateway foi contratado, nenhuma conta financeira foi criada e nenhuma cobrança ou transferência real foi executada nesta revisão.

## Chaves externas

Os nomes Stripe abaixo são **propostos**, não variáveis já consumidas pelo código. Usar primeiro sandbox/teste e depois credenciais de produção separadas.

| Serviço | O que obter | Onde guardar | Necessidade |
| --- | --- | --- | --- |
| Stripe | `STRIPE_SECRET_KEY` | Somente backend/worker | Criar e consultar cobranças e transferências autorizadas. |
| Stripe Webhook | `STRIPE_WEBHOOK_SECRET` | Somente backend | Validar assinatura dos eventos; cada endpoint/ambiente tem seu segredo. Se eventos Connect usarem endpoint separado, guardar outro segredo, por exemplo `STRIPE_CONNECT_WEBHOOK_SECRET`. |
| Stripe no cliente | Chave publicável `pk_…` | Cliente, somente se for adotado Stripe.js/SDK | **Não é necessária** para o fluxo inicial que apenas redireciona ao checkout hospedado. Não colocar `sk_…` no frontend ou no app. |
| Google Maps | `GOOGLE_MAPS_API_KEY` | Backend | Já existe no código. Habilitar **Routes API** e **Geocoding API** no projeto Google Cloud. Restringir as APIs e, quando a infraestrutura permitir, a origem por IP; configurar cotas e acompanhamento de custos. |
| WhatsApp Cloud, opcional | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET` | Backend/worker | Já previstos para mensagens reais. `WHATSAPP_VERIFY_TOKEN` é gerado por nós e cadastrado também na Meta. Configurar template aprovado e `WHATSAPP_NOTIFICATION_TEMPLATE` para notificações que o utilizem. |

Fontes: [chaves Stripe](https://docs.stripe.com/keys), [assinatura dos webhooks](https://docs.stripe.com/webhooks), [Routes API](https://developers.google.com/maps/documentation/routes/get-api-key), [Geocoding API](https://developers.google.com/maps/documentation/geocoding/get-api-key). Os nomes WhatsApp foram conferidos em `src/config/config.service.ts` e `.env.example`; o fluxo real precisa ser homologado na conta Meta antes de ativar.

Se a escolha final for Asaas, substituir o conjunto Stripe por uma chave de API de sandbox/produção (`ASAAS_API_KEY`, nome proposto) e um segredo próprio de webhook (`ASAAS_WEBHOOK_TOKEN`, nome proposto). O provedor recebe a chave no header `access_token`; o receptor valida `asaas-access-token` com o token configurado. Identificadores de cliente, cobrança e recebedor são dados persistidos por entidade, não uma única chave global. [Autenticação Asaas](https://docs.asaas.com/docs/autentica%C3%A7%C3%A3o-1), [webhooks Asaas](https://docs.asaas.com/docs/webhooks-2).

## Segredos e configurações que não são APIs contratadas

| Local | Variáveis | Situação/ação |
| --- | --- | --- |
| Backend | `JWT_SECRET`, `JWT_REFRESH_SECRET`, `PIN_PEPPER` | Gerar valores aleatórios distintos e fortes por ambiente; não substituir os existentes em produção sem planejar invalidação/migração. |
| Backend | `OUTBOX_ENCRYPTION_KEY` | Chave aleatória de 32 bytes em 64 caracteres hex; preservar com backup seguro, pois protege dados já gravados. |
| Frontend servidor | `SESSION_ENCRYPTION_KEY` | Chave própria de 32 bytes/64 hex, independente da chave do backend. |
| Backend | `DATABASE_URL`, `REDIS_URL` | Conexões autenticadas com PostgreSQL/PostGIS e Redis. Não publicar o Redis da EC2 na internet para resolver o frontend. |
| Frontend servidor | `FRONTEND_REDIS_URL` | Redis de sessões acessível pela Vercel com autenticação/TLS. Não é a URL privada de um container na AWS/Render. |
| Endereços públicos | `APP_URL`, `BACKEND_API_URL`, `NEXT_PUBLIC_WS_URL`, `PUBLIC_BASE_URL`, `CORS_ORIGINS` | Configurar URLs reais HTTPS e origens exatas. `BACKEND_API_URL` termina em `/api/v1`; WebSocket usa `/operations`. |
| Aplicativo | `EXPO_PUBLIC_API_URL` ou `EXPO_PUBLIC_IOS_API_URL` | URL pública da API; sem tokens/senhas. `EXPO_PUBLIC_SUPPORT_URL` e `EXPO_PUBLIC_DRIVER_PORTAL_URL` apontam para suporte e cadastro/documentos. |

`NEXT_PUBLIC_API_URL=/api/backend` mantém o BFF do próprio Next.js. Nunca usar `NEXT_PUBLIC_*` ou `EXPO_PUBLIC_*` para segredos. Não enviar chaves pelo chat nem adicioná-las ao Git: cadastrar nos ambientes privados do backend/Vercel/EAS conforme seu papel.

No iPhone, o GPS usa permissões do aparelho; não exige uma chave de pagamento nem uma chave Google adicional. Para gerar e distribuir o aplicativo a partir do Windows, faltam projeto Expo/EAS vinculado e credenciais de assinatura Apple com a adesão adequada. Não é necessário criar uma chave App Store Connect apenas para esta auditoria. Push é uma integração futura, com credenciais APNs/FCM administradas pelo EAS; ainda não existe no aplicativo. [Preparação EAS](https://docs.expo.dev/build/setup/), [configuração de push](https://docs.expo.dev/push-notifications/push-notifications-setup/).

## Implementação necessária antes de dinheiro real

1. Definir cobrança diária versus antecipada, vencimento, limite de crédito, cancelamentos, tarifas, gorjeta e responsabilidade por estorno. Exibir o valor antes da confirmação.
2. Persistir clientes/recebedores do provedor, cobranças com itens imutáveis, alocações de ganhos, transferências, estornos e eventos recebidos. Valores internos em centavos; calcular no servidor.
3. Implementar autorização por estabelecimento/entregador, onboarding de recebedor e alteração protegida de dados bancários. Não guardar cartão no banco ORBITA.
4. Criar comandos idempotentes e vínculo único de cada cobrança/repasse ao provedor. Timeout após envio exige consulta/conciliação; não repetir uma transferência às cegas.
5. Validar assinatura/token do webhook e persistir o evento antes de reconhecer recebimento. Tratar duplicidade, eventos fora de ordem, valores/moeda divergentes e eventos de outra conta/ambiente.
6. Conciliar pagamento confirmado, saldo liberado, entrega concluída, transferência e repasse bancário. O retorno do checkout e a criação da transferência não comprovam pagamento final.
7. Implementar reserva/limite, falha/estorno, liberação única de ganho, histórico e comprovante do provedor. Ajuste administrativo continua sendo ajuste, com motivo e auditoria.
8. Homologar tudo em sandbox: pagamento aprovado/expirado, clique duplo, webhook repetido/falso/atrasado, transferência recusada, falha de rede após envio, conta bloqueada e reembolso. Só então planejar ativação de produção.

Primeiro pré-requisito externo: API HTTPS funcional com worker, banco, Redis, sessões web e domínio de webhook. A falta dessas conexões continua impedindo a operação, mesmo antes de integrar o gateway.
