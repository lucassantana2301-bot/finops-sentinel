import { EXPORT_FORMATS, isIsoDate, isIsoMonth, parseCostExport, parseDimension, SEVERITIES } from '@fns/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../container.js';
import { alertSeverity } from '../container.js';

const isoDate = z.string().refine(isIsoDate, 'data no formato YYYY-MM-DD');
const dimension = z.string().max(140).transform(parseDimension);
const metric = z.enum(['effectiveCost', 'billedCost']).default('effectiveCost');

const periodQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() });

/** Remove chaves undefined: com exactOptionalPropertyTypes o domínio distingue "ausente" de "undefined". */
function defined<T extends Record<string, unknown>>(value: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };
}

export async function registerRoutes(app: FastifyInstance, container: Container): Promise<void> {
  const { service } = container;

  app.get('/health/live', async () => ({ status: 'ok' }));

  app.get('/health/ready', async () => {
    const status = await service.status();
    return { status: 'ok', records: status.records, dataTo: status.to };
  });

  app.register(
    async (v1) => {
      v1.get('/status', async () => ({
        ...(await service.status()),
        sources: container.sources.map((s) => s.name),
        budgets: service.budgets.length,
      }));

      v1.get('/overview', async () => service.overview());

      v1.get('/summary', async (request) => {
        const query = periodQuery
          .extend({
            groupBy: dimension.default('service'),
            metric,
            limit: z.coerce.number().int().min(1).max(500).default(50),
          })
          .parse(request.query);
        return service.summary(defined({ ...query, dimension: query.groupBy }));
      });

      v1.get('/timeseries', async (request) => {
        const query = periodQuery
          .extend({
            groupBy: dimension.default('service'),
            metric,
            top: z.coerce.number().int().min(1).max(20).default(6),
          })
          .parse(request.query);
        return service.timeseries(defined({ ...query, dimension: query.groupBy }));
      });

      v1.get('/anomalies', async (request) => {
        const query = periodQuery
          .extend({ groupBy: dimension.default('service'), minSeverity: z.enum(SEVERITIES).default('low') })
          .parse(request.query);
        return service.anomalies(
          defined({ from: query.from, to: query.to, dimension: query.groupBy, minSeverity: query.minSeverity }),
        );
      });

      v1.get('/forecast', async (request) => {
        const query = z
          .object({ month: z.string().refine(isIsoMonth, 'mês no formato YYYY-MM').optional() })
          .parse(request.query);
        return service.forecast(defined(query));
      });

      v1.get('/recommendations', async (request) => {
        const query = z
          .object({ lookbackDays: z.coerce.number().int().min(7).max(90).default(30) })
          .parse(request.query);
        return service.recommendations(query);
      });

      v1.post('/imports', { preHandler: app.requireApiKey }, async (request, reply) => {
        const query = z.object({ format: z.enum(['auto', ...EXPORT_FORMATS]).default('auto') }).parse(request.query);
        if (typeof request.body !== 'string' || request.body.length === 0) {
          return reply
            .code(415)
            .send({ error: 'UNSUPPORTED_MEDIA_TYPE', message: 'envie o CSV com Content-Type: text/csv' });
        }
        const result = parseCostExport(request.body, { format: query.format });
        const summary = await service.importRecords(result.records, `upload:${result.format}`);
        return reply.code(201).send({
          format: result.format,
          rowsRead: result.rowsRead,
          rowsSkipped: result.rowsSkipped,
          errorCount: result.errorCount,
          errors: result.errors,
          ...summary,
        });
      });

      v1.post('/sync', { preHandler: app.requireApiKey }, async (_request, reply) => {
        if (container.sources.length === 0) {
          return reply
            .code(409)
            .send({ error: 'NO_SOURCES', message: 'nenhuma fonte de nuvem configurada (SOURCES=aws,azure)' });
        }
        await container.syncAll();
        return service.status();
      });

      v1.post('/alerts/run', { preHandler: app.requireApiKey }, async (request) => {
        const query = z
          .object({
            dryRun: z
              .enum(['true', 'false'])
              .default('false')
              .transform((v) => v === 'true'),
            minSeverity: z.enum(SEVERITIES).optional(),
          })
          .parse(request.query);
        return service.runAlerts({
          dryRun: query.dryRun,
          minSeverity: query.minSeverity ?? alertSeverity(container.config),
        });
      });
    },
    { prefix: '/api/v1' },
  );
}
