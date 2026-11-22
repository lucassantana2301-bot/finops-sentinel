/**
 * Erro de regra de negócio. A camada HTTP traduz para 422; qualquer outro erro vira 500.
 */
export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

/** Export de billing que não pôde ser interpretado (formato desconhecido, colunas faltando etc.). */
export class IngestError extends DomainError {
  constructor(message: string) {
    super(message, 'INGEST_ERROR');
    this.name = 'IngestError';
  }
}
