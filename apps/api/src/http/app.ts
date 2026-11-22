import { timingSafeEqual, createHash } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { DomainError, IngestError } from '@fns/core';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import type { Container } from '../container.js';
import { registerRoutes } from './routes.js';

export interface AppOptions {
  container: Container;
  logLevel?: string;
}

const NOT_FOUND_CODES = new Set(['NO_DATA']);
/** Erros de domínio que são, na prática, parâmetro inválido do cliente. */
const BAD_REQUEST_CODES = new Set(['INVALID_DIMENSION', 'INVALID_DATE', 'INVALID_MONTH', 'INVALID_PERIOD']);

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * Compara a chave em tempo constante. O hash antes da comparação iguala o tamanho dos buffers
 * (timingSafeEqual exige o mesmo tamanho) sem vazar o tamanho da chave real.
 */
export function apiKeyMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  return timingSafeEqual(digest(provided), digest(expected));
}

export async function buildApp({ container, logLevel }: AppOptions): Promise<FastifyInstance> {
  const { config } = container;
  const app = Fastify({
    logger: {
      level: logLevel ?? config.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.headers["x-api-key"]'],
    },
    bodyLimit: config.MAX_UPLOAD_MB * 1024 * 1024,
    trustProxy: true,
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
    },
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.CORS_ORIGIN ? config.CORS_ORIGIN.split(',').map((o) => o.trim()) : false,
    methods: ['GET', 'POST'],
  });
  await app.register(rateLimit, { max: config.RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' });

  app.addContentTypeParser(['text/csv', 'text/plain'], { parseAs: 'string' }, (_req, body, done) => done(null, body));

  /** Rotas de escrita exigem API key. Sem API_KEY configurada elas ficam desligadas, nunca abertas. */
  app.decorate('requireApiKey', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!config.API_KEY) {
      return reply.code(503).send({ error: 'WRITE_DISABLED', message: 'configure API_KEY para habilitar esta rota' });
    }
    const header = request.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const provided = bearer ?? (request.headers['x-api-key'] as string | undefined);
    if (!apiKeyMatches(provided, config.API_KEY)) {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'API key ausente ou inválida' });
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: 'parâmetros inválidos',
        issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
    }
    if (error instanceof IngestError) return reply.code(422).send({ error: error.code, message: error.message });
    if (error instanceof DomainError) {
      const status = NOT_FOUND_CODES.has(error.code) ? 404 : BAD_REQUEST_CODES.has(error.code) ? 400 : 422;
      return reply.code(status).send({ error: error.code, message: error.message });
    }
    const { statusCode, code, message } = error as { statusCode?: number; code?: string; message?: string };
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ error: code ?? 'BAD_REQUEST', message: message ?? 'requisição inválida' });
    }
    request.log.error({ err: error }, 'erro não tratado');
    return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'erro interno', requestId: request.id });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({ error: 'NOT_FOUND', message: `rota ${request.method} ${request.url} não existe` }),
  );

  await registerRoutes(app, container);
  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    requireApiKey: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
