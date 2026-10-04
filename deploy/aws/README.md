# ORBITA — EC2 de homologação

Stack exclusiva `orbita-staging`, sem referências a recursos do projeto TradeOS.
O template cria VPC, subnet, internet gateway, rotas, grupo de segurança, função
SSM e uma EC2 Ubuntu 24.04 `t3a.micro` (1 GiB), com 20 GiB gp3 criptografados.
A administração usa Systems Manager, sem chave nem porta SSH. Somente 80/443
aceitam conexões externas. O papel da instância permite somente registro no SSM e
canais de sessão; não permite ler parâmetros, segredos ou bancos do outro projeto.

## Orçamento

Em us-east-1, base estimada para 730 horas: EC2 US$ 6,86; IPv4 US$ 3,65;
20 GiB gp3 US$ 1,60. Total US$ 12,11, antes de impostos, excedentes de tráfego
e outros serviços eventualmente contratados. Orçamento autorizado: US$ 15/mês
para ORBITA. Isso não configura bloqueio automático na AWS. Não criar NAT Gateway,
load balancer, RDS, ElastiCache, Elastic IP, snapshots automáticos ou serviços pagos
adicionais sem rever o orçamento. Créditos existentes são compartilhados pela conta.
CPU em modo standard evita cobranças de CPU Unlimited, mas limita desempenho.

## Implantação

Publicar os arquivos e obter o SHA completo do commit revisado. No CloudShell:

```bash
release=SHA_COMPLETO_REVISADO
curl --fail --location "https://raw.githubusercontent.com/vinicius201717/orbita-backend/$release/deploy/aws/cloudformation.json" -o /tmp/orbita-cloudformation.json
aws cloudformation validate-template --template-body file:///tmp/orbita-cloudformation.json
# Somente após revisar/aprovar os novos acessos IAM e as regras 80/443:
aws cloudformation create-stack --stack-name orbita-staging --template-body file:///tmp/orbita-cloudformation.json --parameters ParameterKey=ReleaseRef,ParameterValue="$release" --capabilities CAPABILITY_IAM --tags Key=Project,Value=ORBITA Key=Environment,Value=staging --region us-east-1
```

`CREATE_COMPLETE` confirma a infraestrutura, não o bootstrap da aplicação.
Conectar via SSM e verificar `/var/log/cloud-init-output.log`,
`/opt/orbita/bootstrap-complete`, `docker compose ps` e
`curl http://127.0.0.1:3000/api/v1/health/ready`.

O bootstrap gera segredos diretamente na EC2, em arquivos root-only, sem copiar
credenciais locais. Usa swap de 2 GiB e builds sequenciais. É um ambiente pequeno
para testes leves; medir consumo real antes de testes concorrentes. Não roda seed.
Mapas simulados, WhatsApp e pagamentos reais desativados.

PostgreSQL/PostGIS, Redis e documentos persistem em volumes Docker no disco da EC2.
Recriar/encerrar a instância pode perder os dados; backups e migração devem anteceder
qualquer substituição. Parar a EC2 mantém cobrança do disco. O IP público pode mudar
após parar/iniciar. Não existe alta disponibilidade nessa configuração.

## HTTPS e integração pendentes de configuração

Antes do HTTPS, o Nginx publica somente `/api/v1/health/live` e devolve 503 no restante.
Configurar domínio, certificado, proxy HTTP/WebSocket, PUBLIC_BASE_URL e CORS antes
de expor autenticação. Não encaminhar senhas/tokens por HTTP.

O frontend da Vercel ainda precisa de armazenamento de sessões acessível e seguro:
não publicar Redis em 6379. Resolver TLS e acesso de sessões antes de afirmar que
o sistema está integrado. Depois republicar as variáveis da API/WebSocket na Vercel
e verificar cadastro, login, logout e operação com o worker.
