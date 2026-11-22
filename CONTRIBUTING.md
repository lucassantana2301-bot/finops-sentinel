# Como contribuir

Obrigado pelo interesse! Este guia descreve o fluxo usado no projeto.

## Ambiente

Pré-requisitos: Node.js 22+ e npm 10+ (Docker opcional).

```bash
npm ci
npm run build:libs
npm run dev:api   # API em http://localhost:3333
npm run dev:web   # painel em http://localhost:5173
```

## Fluxo de trabalho

1. Abra (ou escolha) uma issue descrevendo o problema. Mudanças grandes merecem discussão antes do código.
2. Crie uma branch a partir de `main` com prefixo do tipo: `feat/`, `fix/`, `docs/`, `refactor/`, `ci/`, `chore/`.
3. Faça commits pequenos no padrão [Conventional Commits](https://www.conventionalcommits.org/pt-br/v1.0.0/):
   `feat(api): adiciona filtro por região`, `fix(ingest): trata BOM no CSV`.
4. Rode as verificações antes de abrir o PR:

   ```bash
   npm run lint
   npm run format:check
   npm run typecheck
   npm test
   npm run build
   ```

5. Abra o PR usando o template. O CI precisa estar verde e o PR é integrado com **squash merge**.

## Padrões

- Testes acompanham toda mudança de comportamento; bugs corrigidos ganham um teste de regressão.
- Decisões de arquitetura relevantes viram um ADR em `docs/adr/`.
- Nunca commite segredos, `.env` ou dados reais (billing, clientes, documentos internos).
- Versionamento segue [SemVer](https://semver.org/lang/pt-BR/) e o histórico fica no [CHANGELOG](CHANGELOG.md).

## Release

1. Em um PR, mova os itens de `[Não lançado]` do `CHANGELOG.md` para a nova versão e atualize a versão do projeto (`version` no `package.json` da raiz e dos workspaces).
2. Ao integrar o PR na `main`, o workflow `release.yml` percebe a versão nova, valida o código, publica os artefatos e cria a tag `vX.Y.Z` e a release com as notas do CHANGELOG.
3. Também é possível disparar pela aba Actions (`workflow_dispatch`) ou enviando a tag à mão.
