# Relatório FinOps: 2026-10-22 a 2026-11-20

**Custo efetivo:** US$ 4.719,23 (+7,8% vs. 2026-09-22 a 2026-10-21)  
**Previsão de 2026-11:** US$ 4.753,56 (faixa US$ 4.690,24 a US$ 4.816,88, confiança alta)  
**Economia potencial:** US$ 937,58/mês em 10 recomendação(ões)

## Maiores custos por serviço

| Item              | Custo        | %     |
| ----------------- | ------------ | ----- |
| Amazon EC2        | US$ 1.883,65 | 39,9% |
| Amazon RDS        | US$ 819,54   | 17,4% |
| Virtual Machines  | US$ 533,03   | 11,3% |
| Azure Databricks  | US$ 402,50   | 8,5%  |
| SQL Database      | US$ 372,81   | 7,9%  |
| Amazon S3         | US$ 189,78   | 4%    |
| Azure OpenAI      | US$ 180,16   | 3,8%  |
| Bandwidth         | US$ 117,99   | 2,5%  |
| Storage           | US$ 83,40    | 1,8%  |
| Amazon CloudWatch | US$ 79,68    | 1,7%  |

## Orçamentos

| Orçamento | Valor        | Realizado          | Previsão            | Situação |
| --------- | ------------ | ------------------ | ------------------- | -------- |
| Total     | US$ 4.600,00 | US$ 3.249,27 (71%) | US$ 4.753,56 (103%) | em risco |

## Anomalias (3)

| Data       | Item         | Real       | Esperado  | Impacto    | Severidade | Principal causa       |
| ---------- | ------------ | ---------- | --------- | ---------- | ---------- | --------------------- |
| 2026-11-17 | Azure OpenAI | US$ 44,96  | US$ 0,00  | +US$ 44,96 | média      | oai-assistente        |
| 2026-11-13 | Amazon EC2   | US$ 103,20 | US$ 60,16 | +US$ 43,04 | média      | nat-0f1e2d3c4b5a60001 |
| 2026-11-12 | Amazon EC2   | US$ 112,84 | US$ 60,09 | +US$ 52,75 | alta       | nat-0f1e2d3c4b5a60001 |

## Recomendações

1. **Cobrir o piso de compute com Compute Savings Plan** (economia estimada US$ 375,97/mês)  
   A cobertura de compromisso está em 11,6%. O gasto on-demand de compute nunca fica abaixo de ~US$ 46,42 por dia (percentil 10), então esse piso pode ser comprometido sem risco de ociosidade.  
   _Ação:_ Contrate Compute Savings Plan de 1 ano com compromisso de US$ 1,93/hora e reavalie a cobertura em 30 dias.
2. **Desligar o ambiente "dev" fora do horário comercial** (economia estimada US$ 160,44/mês)  
   O compute de dev na conta 100000000002 custa no fim de semana 100% do que custa num dia útil, ou seja, fica ligado 24x7.  
   _Ação:_ Agende parada e partida (Instance Scheduler na AWS, Start/Stop VMs v2 no Azure) para 12h por dia útil. Estimativa conservadora de 50% de economia.
3. **Cobrir o piso de compute com Azure Savings Plan for Compute** (economia estimada US$ 156,18/mês)  
   A cobertura de compromisso está em 0%. O gasto on-demand de compute nunca fica abaixo de ~US$ 17,35 por dia (percentil 10), então esse piso pode ser comprometido sem risco de ociosidade.  
   _Ação:_ Contrate Azure Savings Plan for Compute de 1 ano com compromisso de US$ 0,72/hora e reavalie a cobertura em 30 dias.
4. **Reduzir processamento de dados no NAT Gateway** (economia estimada US$ 97,34/mês)  
   O processamento de dados nos NAT Gateways custa ~US$ 324,48 por mês. Tráfego para S3 e DynamoDB passando pelo NAT é um caso comum e evitável.  
   _Ação:_ Crie VPC Gateway Endpoints para S3 e DynamoDB (sem custo), use Interface Endpoints para ECR/STS e analise o VPC Flow Logs para achar os maiores destinos.
5. **Atualizar 2 instâncias Standard_D4s_v3 para geração atual** (economia estimada US$ 53,30/mês)  
   2 recursos usam Standard_D4s_v3 na conta a1b2c3d4-0000-4000-8000-000000000001, de geração anterior. Famílias atuais têm preço menor por vCPU e melhor desempenho.  
   _Ação:_ Teste a família Standard_D4s_v5 em homologação e troque o tipo na próxima janela de manutenção.
6. **Atualizar 3 instâncias t2.large para geração atual** (economia estimada US$ 32,09/mês)  
   3 recursos usam t2.large na conta 100000000002, de geração anterior. Famílias atuais têm preço menor por vCPU e melhor desempenho.  
   _Ação:_ Teste a família t3 em homologação e troque o tipo na próxima janela de manutenção.
7. **Migrar 2 volumes EBS de gp2 para gp3** (economia estimada US$ 30,03/mês)  
   Volumes gp3 custam 20% menos por GB-mês que gp2 e têm 3.000 IOPS e 125 MB/s de base. A migração é online, sem parar a instância.  
   _Ação:_ Para cada volume: `aws ec2 modify-volume --volume-id <id> --volume-type gp3`. Revise volumes com IOPS acima de 3.000.
8. **Atualizar 1 instância c4.2xlarge para geração atual** (economia estimada US$ 28,67/mês)  
   1 recurso usa c4.2xlarge na conta 100000000001, de geração anterior. Famílias atuais têm preço menor por vCPU e melhor desempenho.  
   _Ação:_ Teste a família c7i ou c7g (Graviton) em homologação e troque o tipo na próxima janela de manutenção.
9. **IP público ocioso** (economia estimada US$ 3,56/mês)  
   O endereço eipalloc-0123456789abc0001 está alocado sem estar associado a nenhum recurso em execução. Desde 2024 a AWS cobra todo IPv4 público, inclusive o ocioso.  
   _Ação:_ Libere o endereço com `aws ec2 release-address --allocation-id eipalloc-0123456789abc0001` se ele não for necessário.
10. **13,9% do custo sem as tags obrigatórias**  
    Recursos sem "team" e "env" somam ~US$ 654,01 por mês e não podem ser atribuídos a nenhum time. Os maiores estão em: Azure Databricks, Bandwidth, Amazon CloudWatch.  
    _Ação:_ Aplique as tags com AWS Tag Policies / Azure Policy (efeito "deny" ou "modify") e corrija os recursos existentes pelo Resource Groups Tagging API.
