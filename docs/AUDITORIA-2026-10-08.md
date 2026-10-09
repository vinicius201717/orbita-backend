# Auditoria ORBITA — 8 de outubro de 2026

**Conclusão:** existe um MVP funcional e bem estruturado no ambiente local, com backend NestJS, painel Next.js e aplicativo Expo/React Native. A versão publicada ainda não está pronta para uma operação com clientes reais. O login público está bloqueado; o fluxo do PIN não está acessível pelo painel; há problemas de isolamento do limite de requisições e pendências de implantação, recuperação e distribuição móvel.

Esta auditoria avalia o código, a integração local, os artefatos de implantação e a superfície pública acessível. Não é uma certificação de segurança nem uma confirmação de todos os recursos ativos na nuvem. As prioridades abaixo separam defeitos confirmados, lacunas funcionais e verificações ainda necessárias.

## 1. Escopo e versões examinadas

| Área | Local | Estado observado |
| --- | --- | --- |
| API e worker | C:/Users/Vinicius/Documents/ChatGPT/Orbita | NestJS 11.2.7, TypeScript, Prisma 6.19, PostgreSQL/PostGIS, Redis/BullMQ |
| Painel web | C:/Users/Vinicius/Documents/ChatGPT/orbita-frontend | Next.js 16.3.8, React, BFF com sessões em Redis |
| Aplicativo do entregador | C:/Users/Vinicius/Documents/ChatGPT/orbita-motoboy | Expo 57.0.27, React Native 0.86.3, React 19.2.3 |
| Publicação web | [ORBITA na Vercel](https://orbita-frontend-phi.vercel.app/) | Página pública acessível; tentativa de login rejeitada por origem |
| Infraestrutura | Arquivos AWS/Render/Docker e serviços locais | Infraestrutura remota não confirmada nesta auditoria |

Backend: branches locais e remotas codex/development e codex/production no commit **2bfeb76cfcfa4fbad3c513b46bd9b54fe1700d1a**.

Frontend: branches locais e remotas codex/development e codex/production no commit **f6ac59c7ddf184241ceb2f9b9e75fe4fe57e7b3f**.

Mobile: branches locais no commit **a4b74cc**; nenhum remoto Git configurado. O APK disponível pertence à entrega Android anterior, identificada como **0659703**, e não contém todas as alterações atuais.

Foram considerados os dois documentos originais de requisitos e as instruções posteriores sobre identidade visual, painel do estabelecimento e aplicativo simples para Android/iPhone. A instrução posterior de identidade visual substitui a restrição inicial de não estilizar. Pagamentos reais, PIX automático, IA e gamificação não foram tratados como funcionalidades prometidas para este MVP.

## 2. Verificações realizadas

| Verificação | Resultado desta auditoria |
| --- | --- |
| Backend: build, lint e testes unitários | Aprovados; 30 testes, 9 suítes |
| Backend: testes de integração com PostgreSQL/PostGIS e Redis locais | Aprovados; 46 testes, 9 suítes |
| Frontend: testes automatizados | Aprovados; 93 testes |
| Frontend: lint, TypeScript e build Next.js | Aprovados |
| Mobile: testes automatizados | Aprovados; 51 Vitest + 5 Node = 56 testes |
| Mobile: lint e TypeScript | Aprovados |
| Total das suítes acima | **225 testes aprovados** |
| npm audit de dependências de produção do backend | 0 alertas reportados |
| npm audit de dependências de produção do frontend | 0 alertas reportados |
| npm audit completo do mobile | 30 dependências afetadas: 19 high, 11 moderate, 0 critical |
| OpenAPI versionado no backend e frontend | Arquivos idênticos, 76 caminhos |
| Login no domínio público | Falhou com HTTP 403 / CSRF_REJECTED; reproduzido no navegador |
| Limite de requisições por IP | Colisão entre usuários reproduzida em execução isolada do guard real |
| Readiness com worker parado | Resultado status: ok reproduzido com dependências controladas |
| GitHub: sincronização das branches | Confirmada nos dois repositórios remotos |
| GitHub: proteção de production | protected: false nos dois repositórios |
| GitHub Actions | Consulta retornou zero execuções nos dois repositórios |
| GitHub: alertas abertos de secret scanning | Zero retornados; isso não substitui auditoria completa de segredos |

A primeira execução direta de npm run test:integration falhou por configuração de ambiente: tentou PostgreSQL na porta 54432. Depois de carregar o arquivo de ambiente antes do Jest e validar explicitamente o destino local **orbita_test:54329**, as 46 verificações passaram. Não foram 46 defeitos de aplicação. Não houve reset, seed ou migração de banco nesta auditoria.

O OpenAPI sincronizado tem SHA-256 **a5302f776e7647c5cc9aec62da3817ed90d317902007f94bf3200055daa48976**. A igualdade do contrato não garante que todas as telas consumam os endpoints existentes.

Os E2E Playwright do frontend existem, mas não foram reexecutados nesta rodada. Estão fixados em localhost:3001, porta ocupada pela prévia do app, e suas fixtures usam a API/base local de desenvolvimento. A verificação de navegador desta auditoria foi o login público. O E2E operacional também obtém o PIN diretamente pela API, contornando uma lacuna real da interface descrita em A02.

Exportações iOS/Hermes, web e Expo Doctor estão documentadas na validação anterior do app; não equivalem a um build iOS assinado nem foram reapresentadas aqui como testes físicos executados hoje.

## 3. Defeitos e riscos prioritários

Prioridades: **P1** impede o fluxo principal ou precisa ser resolvido antes de uso real; **P2** afeta confiabilidade, segurança operacional ou usabilidade; **P3** manutenção e experiência de desenvolvimento. A coluna “evidência” distingue reprodução de inferência.

### A01 — P1 — Login da versão publicada rejeita a própria origem

**Evidência: HTTP e navegador.** Em https://orbita-frontend-phi.vercel.app/login, uma tentativa com credenciais fictícias e inexistentes retorna HTTP 403, código CSRF_REJECTED e mensagem “Origem da solicitação não permitida”. A rejeição acontece antes da validação das credenciais. Assim, a página inicial estar online não significa que o painel possa ser usado.

O BFF compara a origem da requisição com APP_URL e usa localhost:3001 como fallback. Uma APP_URL ausente/incorreta no deployment é a hipótese principal, mas a configuração privada da Vercel não pôde ser inspecionada. Não é possível concluir, a partir deste 403, se o backend público também está indisponível.

**Correção:** conferir a URL canônica do deployment e APP_URL, rede/publicação do backend, Redis de sessões e chave da sessão; republicar com os valores corretos. Manter a proteção CSRF.

**Aceite:** login e logout reais de estabelecimento e entregador no domínio publicado; sessões sobrevivem a recarregamento e renovação; origem externa continua rejeitada.

Fontes: [validação de origem](<C:/Users/Vinicius/Documents/ChatGPT/orbita-frontend/src/lib/server/request.ts:3>), [comparação da origem](<C:/Users/Vinicius/Documents/ChatGPT/orbita-frontend/src/lib/server/security.ts:2>), [rota de login](<C:/Users/Vinicius/Documents/ChatGPT/orbita-frontend/src/app/api/session/login/route.ts:7>).

![Rejeição de origem reproduzida no login público](<C:/Users/Vinicius/Documents/ChatGPT/Orbita/docs/auditoria-2026-10-08/login-publicado.png>)

### A02 — P1 — O estabelecimento não consegue entregar o PIN ao cliente pelo painel

**Evidência: código e rastreamento do fluxo.** O backend possui POST /deliveries/:id/customer-code. O frontend tem sua declaração no OpenAPI gerado, mas não possui ação que o invoque. A tela do pedido promete “código do cliente” e direciona para uma tela que informa que o código privado não é exibido.

O endpoint só permite gerar o código antes da atribuição a uma rota/motorista. Pedidos do módulo de estabelecimento recebem estimatedReadyAt e podem participar do matching ainda em preparação. Portanto, simplesmente adicionar um botão tardio não resolve a corrida entre geração do código e aceite do entregador.

Há ainda um caso específico: se telefone e opt-in estão presentes, o endpoint responde que o cliente recebe o código por mensagem sem verificar a entrega efetiva. Com WhatsApp desativado, o provider mock registra um envio simulado, sem mensagem real.

**Impacto:** no ambiente de teste atual, não há um caminho normal completo pelo painel para fornecer o PIN ao destinatário. A confirmação administrativa existe, mas não deve substituir sistematicamente a confirmação do cliente.

**Correção:** implementar entrega privada do PIN antes da atribuição ou recuperação/reenvio autorizado ao cliente, com estado claro para falhas do canal. Nunca expor o PIN ao motorista ou em listagens gerais.

**Aceite:** criar pedido pela interface, disponibilizar o PIN somente ao destinatário, aceitar/coletar/entregar e lançar o saldo sem chamada manual à API. Cobrir sem opt-in, WhatsApp desativado, falha do provider e aceite rápido da oferta.

Fontes: [regra de geração](<C:/Users/Vinicius/Documents/ChatGPT/Orbita/src/deliveries/deliveries.service.ts:193>), [candidatos em preparação](<C:/Users/Vinicius/Documents/ChatGPT/Orbita/src/matching/route-candidate.service.ts:25>), [pedido](<C:/Users/Vinicius/Documents/ChatGPT/orbita-frontend/src/features/orders/order-detail-page.tsx:176>), [detalhe](<C:/Users/Vinicius/Documents/ChatGPT/orbita-frontend/src/features/deliveries/detail-page.tsx:210>), [E2E que obtém o código fora da interface](<C:/Users/Vinicius/Documents/ChatGPT/orbita-frontend/tests/e2e/operations.spec.ts:69>).

A página pública de confirmação do destinatário existe no backend. O problema encontrado é a distribuição/acessibilidade do código no fluxo operacional, não a ausência de toda confirmação de cliente.

### A03 — P1 — Usuários diferentes compartilham a mesma cota de requisições atrás do proxy

**Evidência: código e reprodução isolada.** RateLimitGuard usa somente controlador/ação e hash de request.ip. O bootstrap não configura uma cadeia de proxies confiáveis, e as chamadas do BFF ao backend não preservam uma identidade de cliente para esse limite.

Na topologia com proxy/BFF, requisições de pessoas diferentes podem aparecer com o mesmo IP. Executando o guard real com Redis controlado, 15 tentativas de login de uma conta esgotam a cota e bloqueiam a primeira tentativa de outra conta no mesmo endereço. O mesmo desenho afeta consultas e localização em seus respectivos limites.

**Correção:** usar identidade autenticada validada para cotas individuais e definir uma política explícita de proxies confiáveis para requisições anônimas. Não aceitar indiscriminadamente um X-Forwarded-For enviado pelo cliente.

**Aceite:** carga simultânea de várias contas pelo mesmo caminho Vercel/proxy não esgota a cota individual das demais; tentativas abusivas continuam limitadas.

Fontes: [guard](<C:/Users/Vinicius/Documents/ChatGPT/Orbita/src/common/rate-limit.guard.ts:14>), [bootstrap](<C:/Users/Vinicius/Documents/ChatGPT/Orbita/src/bootstrap.ts:7>), [BFF](<C:/Users/Vinicius/Documents/ChatGPT/orbita-frontend/src/lib/server/backend.ts:17>).

### A04 — P2 — Readiness pode indicar sucesso com worker inoperante

**Evidência: código e reprodução isolada.** GET /health/ready retorna status: ok quando PostGIS e Redis respondem, mesmo que jobs.health informe worker: stale. Um monitor que verifica apenas HTTP 200 ou o campo principal não detectará a interrupção de matching, outbox e tarefas.

**Correção:** definir readiness operacional que reflita a dependência do worker, ou monitor dedicado obrigatório com alerta. Manter a distinção entre liveness do processo e saúde da operação.

**Aceite:** interromper somente o worker em ambiente isolado produz alerta detectável; a API não informa operação saudável de forma enganosa.

Fontes: [health](<C:/Users/Vinicius/Documents/ChatGPT/Orbita/src/health/health.controller.ts:20>), [heartbeat](<C:/Users/Vinicius/Documents/ChatGPT/Orbita/src/jobs/jobs.service.ts:183>).

### A05 — P2 — App não recupera automaticamente uma abertura inicial sem internet

**Evidência: análise estática; cenário físico pendente.** Ao abrir o app com tokens salvos, restore é seguido por uma consulta de identidade. Se a consulta falha por rede, currentUser permanece nulo. Tanto o temporizador quanto a volta ao primeiro plano chamam refresh, que retorna imediatamente quando não há currentUser.

**Impacto esperado:** a conexão volta, mas a restauração da sessão não é tentada novamente nessa instância do app. O usuário pode precisar entrar novamente ou reiniciar o aplicativo. Isso é diferente da recuperação de rede depois de uma sessão já carregada.

**Correção:** modelar restauração pendente/sem rede e permitir retry de identidade sem apagar tokens válidos por uma falha transitória.

**Aceite:** abrir offline com sessão válida, restabelecer rede e recuperar a operação sem redigitar credenciais; 401 definitivo continua encerrando a sessão.

Fonte: [estado do entregador](<C:/Users/Vinicius/Documents/ChatGPT/orbita-motoboy/src/state/driver-context.tsx:39>) e inicialização na linha 72.

### A06 — P2 — Dependências móveis precisam de tratamento antes da distribuição

**Evidência: npm audit e árvore instalada.** Há 30 dependências afetadas, com 19 classificações high e 11 moderate. A contagem inclui pacotes que herdam alertas de dependências; não representa 30 explorações independentes no aplicativo.

Os alertas de origem incluem braces, node-forge, decode-uri-component e uuid. Parte está na cadeia de ferramentas Expo/Metro. Entretanto, decode-uri-component 0.2.2 é carregado por query-string 7.1.3 usado por expo-router 57.0.25; merece avaliação de exposição em URLs/deep links, e não pode ser descartado como ferramenta de compilação.

O advisory de decode-uri-component descreve consumo excessivo de CPU com entrada malformada e correção em 0.5.0. Referências: [decode-uri-component](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr), [braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), [node-forge](https://github.com/advisories/GHSA-86w9-cpqp-85rv), [uuid](https://github.com/advisories/GHSA-w5hq-g745-h8pq).

**Correção:** atualizar o conjunto compatível do SDK ou aplicar correções transitivas verificadas. Não executar npm audit fix --force indiscriminadamente: a saída sugere inclusive downgrades incompatíveis para parte da árvore.

**Aceite:** triagem registrada de cada advisory de origem, versões compatíveis, nova auditoria e builds/testes de navegação e links nas plataformas suportadas.

### A07 — P2 — Telas antigas não acompanham funcionalidades já disponíveis

**Evidência: código.** O formulário legado de nova entrega afirma que busca de endereço não existe na API, mas POST /business/addresses/search e AddressField já existem. O cadastro inicial exige latitude/longitude e também declara ausência de conversão. A busca atual exige um estabelecimento ativo; reaproveitá-la durante o cadastro exige ajustar essa sequência, não apenas copiar o componente.

O painel web do entregador diz não haver recorte diário, apesar de GET /driver/summary já fornecer dados do dia para o app. Recortes semanais/mensais continuam sendo uma lacuna real. O onboarding do estabelecimento diz que WhatsApp não pode ser consultado, embora GET /whatsapp/me exista.

**Correção:** unificar o caminho simples de pedidos, reduzir campos técnicos, reutilizar os contratos atuais e distinguir “serviço não configurado” de “funcionalidade inexistente”.

**Aceite:** um estabelecimento cadastra unidade e pedido por endereço/ponto confirmado, sem precisar compreender latitude, longitude, SLA em segundos ou capacidade técnica; telas não contradizem a API.

Fontes: [cadastro](<C:/Users/Vinicius/Documents/ChatGPT/orbita-frontend/src/features/auth/business-registration-form.tsx:202>), [entrega legada](<C:/Users/Vinicius/Documents/ChatGPT/orbita-frontend/src/features/deliveries/create-page.tsx:236>), [busca existente](<C:/Users/Vinicius/Documents/ChatGPT/Orbita/src/maps/business-addresses.controller.ts:34>), [ganhos](<C:/Users/Vinicius/Documents/ChatGPT/orbita-frontend/src/features/driver/earnings-page.tsx:50>), [onboarding](<C:/Users/Vinicius/Documents/ChatGPT/orbita-frontend/src/features/business/onboarding.tsx:36>).

### A08 — P2 — Entrega contínua e proteção das branches incompletas

**Evidência: arquivos e GitHub.** Backend e mobile não têm workflow de CI no repositório. Frontend tem workflow de lint, tipos, testes e build, mas a consulta de Actions retornou zero execuções. As branches remotas de produção dos dois repositórios estão sem proteção.

**Correção:** CI reproduzível em cada projeto, integração do backend com serviços isolados, verificação de contrato e E2E crítico sem atalhos de interface. Confirmar execução real antes de tornar os checks obrigatórios. Definir promoção e rollback.

**Aceite:** uma alteração que quebra login, contrato ou conclusão de entrega falha no pipeline; publicação de produção depende dos checks definidos.

Fonte: [workflow frontend](<C:/Users/Vinicius/Documents/ChatGPT/orbita-frontend/.github/workflows/ci.yml:1>) e estado remoto consultado em 08/10/2026.

### A09 — P2 — Código mobile sem cópia remota e artefato desatualizado

**Evidência: Git e documentação de build.** git remote -v não retorna remoto no projeto mobile. O APK disponível é anterior aos ajustes iOS/compartilhados. Ainda não existe IPA assinado.

**Correção:** publicar o repositório mobile no destino autorizado quando definido, fixar versões/releases e gerar novos artefatos a partir do commit auditado após as correções.

**Aceite:** código recuperável fora deste computador, build identificável por commit/versão e app instalado com a API de teste pública correta.

### A10 — P3 — Comando de integração depende de preparação implícita do ambiente

**Evidência: falha inicial reproduzida e execução corrigida.** O setup de integração escolhe DATABASE_URL antes de a configuração da aplicação carregar o arquivo .env. Sem TEST_DATABASE_URL exportado antecipadamente, usa o fallback na porta 54432, diferente da infraestrutura local atual na 54329.

**Correção:** documentar e automatizar o carregamento das variáveis de teste antes do Jest, com proteção explícita contra banco de desenvolvimento/produção.

**Aceite:** instalação limpa consegue executar o comando documentado contra orbita_test sem edição manual; destino inadequado é recusado antes de qualquer escrita.

Fonte: [setup da integração](<C:/Users/Vinicius/Documents/ChatGPT/Orbita/test/integration-env.ts:1>).

## 4. Implantação e recuperação: condições ainda não demonstradas

Estas pendências são condições de lançamento, não afirmações de que a conta AWS não possui recursos.

| Condição | Evidência e pendência | Prioridade |
| --- | --- | --- |
| API pública HTTPS | Não foi comprovada uma URL operacional atendendo web e app nesta rodada. Credenciais AWS indisponíveis na CLI; consulta ao projeto Vercel negada no contexto autenticado disponível. | P1 antes do piloto externo |
| Configuração publicada | Validar APP_URL, BACKEND_API_URL, sessão/Redis, CORS, WebSocket, PUBLIC_BASE_URL e segredos dos ambientes corretos. O 403 público confirma ao menos um bloqueio na entrada do BFF. | P1 |
| Mapas reais | Ambiente local e bootstrap usam mock. Existe provider Google e geocoding; NODE_ENV=production rejeita mapas mock. Validar rotas, tempo, erro de provider e limites de custo antes de operação real. | P1 |
| WhatsApp real ou alternativa de PIN | Ambiente local/bootstrap têm WhatsApp desligado. Provider, webhook e consentimento existem no código; envio real ao destinatário não foi demonstrado. Resolver A02 mesmo em piloto sem WhatsApp. | P1 |
| Backup e restauração | Compose mantém PostgreSQL, Redis e documentos em volumes da mesma EC2. CloudFormation configura DeleteOnTermination: true no disco. Não foi encontrada automação de backup/restore no repositório nem foi verificado backup externo ativo. | P1 antes de guardar dados reais |
| Monitoramento operacional | Corrigir A04; monitorar worker, fila, erros, disco, memória, atraso de mensagens e ausência de GPS. Definir responsável e canal de alerta. | P2 |
| Limite de custo | Template prevê t3a.micro e disco de 20 GB. Isso não comprova gratuidade na conta. Verificar elegibilidade/créditos, orçamento e custos de IP/disco/tráfego/provedores antes de ampliar recursos. | P2 |
| Capacidade | Nenhum teste de carga representativo foi executado. EC2 pequena e serviços no mesmo host exigem medir latência, memória e atraso do matching com várias contas. | P2 |
| Release/rollback | Confirmar migrações controladas, versão de imagem e retorno à versão anterior sem perder dados. Docker de produção não foi validado nesta rodada. | P2 |

O bootstrap AWS começa com proxy público restrito: disponibiliza health/live e responde 503 às demais rotas. Isso é o comportamento do arquivo, não uma medição da EC2 ativa. É necessário conferir o estágio efetivo da implantação.

Fontes: [compose AWS](<C:/Users/Vinicius/Documents/ChatGPT/Orbita/deploy/aws/compose.yaml:1>), [disco](<C:/Users/Vinicius/Documents/ChatGPT/Orbita/deploy/aws/cloudformation.json:249>), [bootstrap](<C:/Users/Vinicius/Documents/ChatGPT/Orbita/deploy/aws/bootstrap.sh:49>), [validação de produção](<C:/Users/Vinicius/Documents/ChatGPT/Orbita/src/config/config.service.ts:92>).

Backup aceito significa restauração testada de banco e documentos, com preservação segura das chaves necessárias para dados criptografados. Definir quanto dado pode ser perdido e quanto tempo a operação pode ficar parada; apenas possuir um volume persistente não resolve perda da instância.

## 5. Cobertura funcional e o que falta

| Área | O que já existe | O que falta ou precisa ser concluído |
| --- | --- | --- |
| Identidade visual web | Logo reutilizável, símbolo, cores centralizadas, Sora/Inter locais, CSS Modules e estilos base | Revisão visual ampla em tamanhos/fontes reais; não há necessidade de trocar a stack de estilos |
| Estabelecimento | Cadastro, unidades, catálogo básico, disponibilidade de produto, pedido com preço calculado no servidor, resumo e acompanhamento | PIN, cadastro por endereço mais simples, redução de telas/campos legados, validar experiência com usuário leigo |
| Catálogo | Nome, preço e disponibilidade | Fotos, adicionais, combos, estoque e importação são melhorias possíveis, não bloqueadores automáticos do MVP |
| Entregador web | Cadastro/documentos, veículo, consentimento, ofertas, rotas, saldo | Reutilizar resumo diário atual e remover informações desatualizadas |
| Entregador mobile | Login, ativar/parar, GPS, ofertas, etapas da entrega, navegação externa, saldo e conta | Recuperação offline A05, distribuição, teste físico e caminho claro de suporte |
| Android | Código e APK local de teste anterior | Novo APK assinado adequadamente para distribuição, API acessível fora da LAN e teste real de bateria/GPS |
| iPhone | Configuração iOS, permissões, áreas seguras, teclado, Apple Maps, perfis EAS e testes de lógica | Projeto EAS/assinatura/distribuição ainda não concluídos; não há IPA nem teste no aparelho |
| Ofertas em segundo plano | GPS nativo em segundo plano implementado | Ofertas são consultadas a cada 15 s com app ativo; não há push. Planejar mecanismo de aviso se o piloto exigir app fechado/bloqueado |
| Cadastro pelo app | Conta e veículo exibidos | Criação de conta, envio de documentos e alteração de veículo continuam no web/atendimento; tornar essa orientação acionável |
| Matching/rotas | Pool, prioridades, inserção dinâmica, múltiplas coletas, restrições e aceite atômico | Validação de carga e cenários reais com mapas/tempos de preparo; não inferir capacidade apenas dos testes |
| Confirmação de entrega | PIN protegido, tentativas, prova e confirmação administrativa | Fechar A02 e ensaiar recuperação sem expor código ao entregador |
| Financeiro | Ledger, carteiras, lançamentos e ajustes administrativos | Definir conciliação/liquidação manual do piloto. Saldo interno não é saque bancário |
| Administração | Revisões, documentos, entregas, incidentes, carteiras e ajustes | Gestão de equipe/acessos do estabelecimento; edição/desativação de zonas; parâmetros de preço/matching são consulta, sem edição no painel |
| Conta e suporte | Login, refresh, logout e troca de senha autenticada | Recuperação de senha esquecida, verificação de e-mail e canal de suporte operacional |
| Analytics | Resumos e métricas operacionais básicas | Filtros consistentes de período, relatórios e instrumentação de latência do matching/uso de rota; endpoint Prometheus implementa 7 indicadores |
| Privacidade | Solicitações de exportação/exclusão podem ser criadas/listadas; retenção e consentimento têm partes implementadas | Não há processamento/conclusão das solicitações; definir responsável, execução e textos operacionais antes de uso público |
| Documentação | Arquitetura, contratos, implantação e guias de app | Atualizar contagens de testes e afirmações antigas sobre endpoints ausentes; registrar ambiente e release efetivamente publicados |

Referências de cobertura: [tokens web](<C:/Users/Vinicius/Documents/ChatGPT/orbita-frontend/src/styles/tokens.css:1>), [logo](<C:/Users/Vinicius/Documents/ChatGPT/orbita-frontend/src/components/brand/logo.tsx:3>), [admin](<C:/Users/Vinicius/Documents/ChatGPT/Orbita/src/admin/admin.controller.ts:1>), [métricas](<C:/Users/Vinicius/Documents/ChatGPT/Orbita/src/common/metrics.controller.ts:1>), [solicitações de privacidade](<C:/Users/Vinicius/Documents/ChatGPT/Orbita/src/users/privacy.controller.ts:13>), [guia iOS](<C:/Users/Vinicius/Documents/ChatGPT/orbita-motoboy/docs/IOS.md:1>).

Notificações push e pagamentos reais foram adiados no escopo original. São decisões de evolução, e não defeitos de algo já implementado. O mesmo vale para exportação/exclusão automática inicialmente tratada como preparação futura; a pendência atual é definir uma operação de atendimento dessas solicitações.

A estilização escolhida é adequada: **CSS Modules com tokens e estilos globais básicos no Next.js; StyleSheet e tema central no React Native**. Manter essa separação evita transportar CSS de navegador para código nativo. As cores da marca estão alinhadas entre os projetos.

## 6. Sequência recomendada de conclusão

| Ordem | Trabalho | Critério para considerar concluído |
| --- | --- | --- |
| 1 | Corrigir origem/sessões e comprovar API pública | Login real de ambos os perfis, refresh e logout em HTTPS no deployment correto |
| 2 | Fechar o fluxo do PIN | Pedido criado pelo painel, aceito no app, coletado, entregue com código do cliente e saldo lançado sem intervenção técnica |
| 3 | Corrigir cotas compartilhadas e readiness | Várias contas operam simultaneamente; falha do worker gera detecção e alerta |
| 4 | Preparar piloto recuperável | Backup restaurado em ambiente separado, versão identificável, suporte e rollback definidos |
| 5 | Consolidar UX e sessão mobile | Endereço acessível ao leigo, recuperação offline, mensagens coerentes e suporte acionável |
| 6 | Tratar dependências e distribuir os apps | Release atual do Android e build iOS assinado quando os pré-requisitos estiverem disponíveis |
| 7 | Validar aparelhos e rede real | GPS com tela bloqueada, retorno de rede, permissões revogadas, pausa durante carga, PIN e saldo em Android/iPhone |
| 8 | Automatizar qualidade e expansão | CI executado, checks obrigatórios, contrato/E2E sem atalhos, teste de carga do volume esperado |
| 9 | Evoluir negócio conforme o piloto | Gestão de equipe, relatórios, catálogo ampliado, notificações e pagamentos apenas conforme necessidade definida |

A prioridade não é acrescentar mais telas. É tornar o ciclo existente completo e recuperável: **estabelecimento cria → cliente recebe seu código → entregador aceita → coleta → entrega → saldo registra → operação consegue acompanhar e resolver falhas**.

## 7. Limites e evidências

- A auditoria não alterou a lógica do produto nem publicou mudanças. Foram gerados este relatório, sua imagem de evidência e artefatos locais ignorados.
- Os testes de integração usaram o banco local de teste, não dados de produção. Os ensaios do guard e health usaram dependências controladas, sem consumir cotas de usuários reais.
- A tentativa pública de login usou identidade fictícia. Não foi necessário expor credenciais do usuário.
- Não houve acesso autenticado suficiente para certificar a EC2, backups, regras de rede, certificados, variáveis privadas ou cobrança da conta AWS/Vercel.
- Nenhum iPhone/Android físico foi testado nesta rodada. Não se pode concluir que GPS em segundo plano, consumo de bateria ou assinatura/distribuição estejam aprovados.
- Zero alertas em npm audit não significa ausência de falhas de aplicação. O login/PIN demonstram por que testes e inspeção de fluxo precisam acompanhar build e auditoria de pacotes.
- Não foi feito pentest exaustivo, teste de carga, auditoria de todos os commits históricos ou análise jurídica. Solicitações de privacidade e termos foram avaliados como funcionalidades e processos pendentes.

Artefatos de apoio: imagem em docs/auditoria-2026-10-08/login-publicado.png; auditorias npm ignoradas em .runtime dos respectivos projetos; ensaio isolado em .runtime/audit-guards-2026-10-08.cjs. O relatório mantém as evidências essenciais mesmo sem esses arquivos temporários.

