# Validação local — 4 de outubro de 2026

## Evidências executadas

- `npm run build`: TypeScript da aplicação compilado.
- `npx tsc --noEmit -p tsconfig.json`: aplicação, testes, seed e scripts tipados.
- `npm run lint`: ESLint sem warnings, sem `any` explícito e sem non-null assertions.
- `npm run test:unit`: 28 testes em 8 suítes.
- `npm run test:integration`: 35 testes em 7 suítes, contra PostgreSQL/PostGIS e Redis reais.
- Cinco migrations aplicadas em `orbita` e `orbita_test`, incluindo identidade frontend e documentos privados.
- `GET /auth/me`, edição de conta, troca de senha, rotas escopadas, edição de filial, consentimento WhatsApp, carteiras administrativas, resolução de incidentes e documentos privados cobertos pelo contrato exportado.
- Seed executado e repetível sem sobrescrever dados existentes.
- Simulador: 5/5 entregas concluídas, rotas encerradas, ledger creditado. Última execução: `6bc073a0-9d27-4a95-80a0-f80e51fb6f5a`, 11 passos.
- API compilada e worker iniciados; health consultado por HTTP e Swagger disponível.
- `npm audit --omit=dev`: zero vulnerabilidades após overrides das dependências transitivas.

## O que os testes demonstram

| Área | Evidência |
|---|---|
| Auth/RBAC | Cadastro não promove ADMIN; acesso sem token bloqueado; identidade projetada por ator; troca de senha invalida access/refresh anteriores |
| Tenancy | Empresa não lê nem cria entregas em unidade alheia |
| GPS | Redis aceita snapshot monotônico; worker persiste lote; offline remove presença |
| Inserção | Enumeração de posições, pickup antes de dropoff, SLA, carga, categoria e economia |
| Distribuição | Cinco pedidos: duas inserções em rota existente e três em nova rota; driver distante excluído. Fixture usa limite configurável de três entregas por rota, além da capacidade física |
| Concorrência | Dois motoristas disputam a mesma entrega em transações reais: um vencedor |
| Route mutation | Oferta inválida depois de mudança da versão; dropoff não pode contornar prova |
| PIN/financeiro | Erro de PIN persiste contador; confirmações simultâneas resultam em um earning e um ledger balanceado |
| Custódia | Cancelamento após pickup mantém driver/rota e requer devolução |
| Expiração | Oferta expirada libera entrega ao pool e não pode ser aceita |
| Regressões de aceite | Heartbeat parado não invalida oferta; reatribuição à mesma rota reutiliza paradas puladas sem duplicá-las |
| Ajuste financeiro | Requisições simultâneas geram um único ajuste; reutilização da chave com outro valor ou motivo é recusada |
| Realtime | Empresas de uma rota compartilhada recebem somente o ID da rota quando muda uma entrega de outra empresa |
| WhatsApp | Assinatura inválida, payload inválido, duplicação simultânea, máquina de estados, identidade desconhecida/conhecida e roteamento de botões |
| Revogação WhatsApp | Contas excluídas/desativadas, telefone alterado, consentimento revogado e identidade reassociada bloqueiam operações e mensagens pendentes; PIN de cliente mantém consentimento próprio |
| Documentos | Upload multipart limitado a 5 MB, assinatura PDF/PNG/JPEG conferida, conteúdo privado por ownership, hash verificado, revisão administrativa e reenvio auditado |
| Infra/worker | Índices espaciais existentes, transação financeira vazia rejeitada no commit e job real BullMQ concluído com heartbeat |

Os testes de roteamento dos botões isolam os métodos accept/reject; a atomicidade desses métodos é verificada separadamente nos testes de logística com PostgreSQL real.

## Não verificado externamente

Chamadas Google/Meta com credenciais reais, aprovação de templates, trânsito real, comportamento de GPS de aparelhos físicos, carga de milhares de motoristas e imagem Docker. Não houve envio de WhatsApp ou dinheiro real. As garantias verificadas são do ambiente local e dos cenários cobertos; não representam certificação de prontidão operacional.

## Ambiente usado

Node 24.11.1; NestJS 11.2.7; TypeScript 5.9.3; Prisma 6.19; PostgreSQL 14.24 com PostGIS 3.2 (cluster WSL dedicado); Redis 7.4.11. Compose declara PostgreSQL 16/PostGIS e Redis 7.4 para instalação isolada em Docker.

A primeira tentativa de revalidação em 2 de outubro falhou por indisponibilidade da porta do banco no Windows: `55432` entrou em uma faixa reservada pelo sistema. O cluster dedicado e as configurações foram movidos para `54432`; a suíte completa passou após a correção, sem recriar bancos ou apagar dados.
