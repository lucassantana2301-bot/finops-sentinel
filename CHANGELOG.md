# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto adota o
[Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Não lançado]

## [1.0.0] - 2026-11-22

Primeira versão estável.

### Adicionado

- **Modelo de dados FOCUS 1.0** com custo faturado e efetivo, amortização de Savings Plans e Reservas
  e catálogo de serviços normalizado entre AWS e Azure.
- **Ingestão de arquivos**: exports FOCUS, AWS CUR (legado e 2.0) e Azure Cost Details, com detecção
  automática de formato, relatório de erros por linha e rejeição de arquivos corrompidos.
- **Conectores somente leitura**: AWS Cost Explorer e Azure Cost Management Query API, com paginação,
  retry com `Retry-After` e sincronização agendada.
- **Detecção de anomalias** por mediana móvel com sazonalidade semanal e escore z robusto (MAD),
  severidade pelo impacto em dinheiro e identificação do recurso causador.
- **Previsão de fechamento do mês** com faixa de confiança e **orçamentos por escopo**
  (conta, provedor ou tag) com alerta antecipado.
- **7 regras de recomendação de economia** com valor estimado e comando de execução.
- **Alertas** para Slack e webhook assinado com HMAC-SHA256, com deduplicação e reenvio.
- **API REST** (Fastify) com autenticação por API key, rate limit e jobs de sync e alertas.
- **Painel web** (React 19 + Recharts) com gráfico diário, orçamentos, anomalias e recomendações.
- **CLI** que gera relatório Markdown/JSON e retorna código de saída para uso em pipelines.
- **Demo ao vivo** no GitHub Pages: o mesmo domínio da API rodando no navegador com dados sintéticos.
- **Imagens Docker** sem root publicadas no GHCR com SBOM e atestado de proveniência.
- **Qualidade**: CI em Node 22 e 26, lint, checagem de tipos, 79 testes com cobertura consolidada,
  CodeQL, Dependabot e ADRs das principais decisões.

[Não lançado]: https://github.com/lucassantana2301-bot/finops-sentinel/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/lucassantana2301-bot/finops-sentinel/releases/tag/v1.0.0
