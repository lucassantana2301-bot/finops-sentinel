# Conectando AWS e Azure

O FinOps Sentinel só lê dados de custo. Nenhuma das configurações abaixo concede permissão de escrita.

Escolha **uma fonte por conta pagadora**: Cost Explorer e CUR da mesma conta representam a mesma fatura e somariam em dobro.

## AWS

### Opção 1: Cost Explorer (mais rápida)

Crie uma role (ou usuário de serviço) com a política:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "FinOpsSentinelReadOnly",
      "Effect": "Allow",
      "Action": ["ce:GetCostAndUsage"],
      "Resource": "*"
    }
  ]
}
```

Variáveis da API:

```bash
SOURCES=aws
AWS_PAYER_ACCOUNT_ID=123456789012
# credenciais pela cadeia padrão do SDK: role da instância/ECS/EKS (IRSA), AWS SSO ou AWS_PROFILE
```

Para ver todas as contas da organização, use a conta pagadora (management account) ou uma conta com acesso delegado ao Cost Explorer.

Cada chamada da API Cost Explorer custa US$ 0,01. A sincronização padrão (35 dias, a cada 6 horas) faz poucas chamadas por execução, mas o conector limita o número de páginas (`maxPages`) para evitar surpresa.

O Cost Explorer não traz recurso nem tag na mesma consulta. As regras por recurso (gp2, IP ocioso, geração anterior) precisam do CUR.

### Opção 2: Data Exports (CUR 2.0 ou FOCUS)

1. Billing and Cost Management → Data Exports → Create.
2. Tipo **FOCUS 1.0** (recomendado) ou **CUR 2.0**, granularidade diária, formato CSV, com IDs de recurso.
3. Destino: um bucket S3. Sincronize os arquivos para `DATA_DIR` (`aws s3 sync`) ou envie para `POST /api/v1/imports`.

## Azure

### Opção 1: Cost Management Query API

1. Crie um Service Principal (ou use Managed Identity):

   ```bash
   az ad sp create-for-rbac --name finops-sentinel --role "Cost Management Reader" \
     --scopes /subscriptions/<subscription-id>
   ```

2. Variáveis da API:

   ```bash
   SOURCES=azure
   AZURE_SCOPE=/subscriptions/<subscription-id>
   AZURE_TENANT_ID=...
   AZURE_CLIENT_ID=...
   AZURE_CLIENT_SECRET=...   # dispensável com Managed Identity
   ```

Escopos aceitos: `/subscriptions/<id>`, `/providers/Microsoft.Billing/billingAccounts/<id>` (EA/MCA) e `/providers/Microsoft.Management/managementGroups/<id>`. A API tem limite de requisições; o conector respeita o `Retry-After` que o Azure devolve.

### Opção 2: Exports

Cost Management → Exports → **FOCUS cost and usage** (recomendado, já traz faturado e efetivo) ou **Cost and usage details (amortized)**, diário, para um Storage Account. Copie os arquivos para `DATA_DIR` ou envie pela API.

## Alertas

```bash
ALERT_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
ALERT_WEBHOOK_URL=https://seu-endpoint/finops        # n8n, Power Automate, Lambda...
ALERT_WEBHOOK_SECRET=<32+ caracteres>                # assina o corpo: X-FinOps-Signature: sha256=<hex>
ALERT_MIN_SEVERITY=medium
```

Validação da assinatura no receptor (Node.js):

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

function isValid(body: string, header: string, secret: string): boolean {
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(body).digest('hex')}`);
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
```

Com mais de uma réplica da API, desligue o job interno (`ALERT_INTERVAL_MINUTES=0`) e agende uma única chamada a `POST /api/v1/alerts/run` (CronJob do Kubernetes, EventBridge Scheduler) para não duplicar alertas.
