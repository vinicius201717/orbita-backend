# Render — homologação

O `render.yaml` prepara quatro recursos na região Virginia: API NestJS, worker BullMQ,
PostgreSQL 16 com PostGIS (instalado pela migration inicial) e Key Value persistente.
Um disco de 1 GB na API preserva os documentos privados entre publicações.
O deploy usa o runtime Node nativo, mantendo o Prisma CLI disponível para migrations.
Não usa o Dockerfile, cujo estágio final não contém as migrations.

## Custo e aprovação

Confirme o orçamento no resumo do Render antes de aplicar o Blueprint. Os recursos
são pagos e recorrentes; criar o arquivo ou conectar o repositório não os contrata.
O dimensionamento é inicial para testes, sem autoscaling. Monitore memória, espaço
e tráfego antes de aumentar os limites. O plano do workspace continua Hobby.

## Configuração

- Fonte: `codex/production`; deploy automático desligado nesta homologação.
- `NODE_ENV=development` com execução compilada, sem watch, permite mapas simulados.
  Não usar essa configuração para entregas reais. A validação de produção permanece
  exigindo Google Maps e sua chave quando `NODE_ENV=production`.
- WhatsApp e pagamentos reais estão desligados.
- Render gera segredos novos, compartilhados entre API e worker pelo grupo de ambiente.
  `render-start.mjs` converte a chave de criptografia base64 para os mesmos 32 bytes em hex.
  Não substituir essa chave após gravar dados criptografados sem uma migração de chaves.
- Migrations executam antes da inicialização, nunca durante o build.
  Se o primeiro deploy simultâneo disputar o advisory lock do Prisma, aguarde a conclusão
  da migration e repita apenas o deploy que falhou.
- PostgreSQL e Redis aceitam somente a rede privada do Render inicialmente.
- O seed local não é executado: ele contém dados de demonstração e depende de senha própria.

## Verificação após provisionamento

1. Confirmar API e worker ativos e migrations aplicadas.
2. Verificar `/api/v1/health/live` e `/api/v1/health/ready`, incluindo heartbeat do worker.
3. Configurar a Vercel: `BACKEND_API_URL=<URL da API>/api/v1`,
   `NEXT_PUBLIC_WS_URL=<URL da API>/operations`,
   `APP_URL=https://orbita-frontend-phi.vercel.app` e `NEXT_PUBLIC_APP_ENV=staging`.
4. Configurar Redis para as sessões do frontend e `SESSION_ENCRYPTION_KEY` próprio.
   A URL privada do Render não funciona na Vercel. Definir acesso externo TLS autenticado
   ou um armazenamento separado de sessões antes de testar login; não abrir a rede
   pública do Redis automaticamente.
5. Republicar o frontend para incorporar a URL pública do WebSocket e testar cadastro,
   login, renovação, logout, permissões e operações com uma conta de homologação.

O endereço público da API é obtido de `RENDER_EXTERNAL_URL`; nenhum segredo local é
copiado para o repositório ou para a plataforma.
