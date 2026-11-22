import { describe, expect, it } from 'vitest';
import { run, type Io } from '../src/cli.js';

function memoryIo(files: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    readFile: async (path) => {
      const content = files[path];
      if (content === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT', path });
      return content;
    },
    writeFile: async (path, content) => {
      files[path] = content;
    },
  };
  return { io, files, out: () => out.join(''), err: () => err.join('') };
}

describe('CLI', () => {
  it('gera o dataset de demonstração e produz o relatório Markdown', async () => {
    const mem = memoryIo();
    expect(await run(['demo', '--out', 'demo.csv', '--end', '2026-11-20'], mem.io)).toBe(0);
    expect(mem.files['demo.csv']).toMatch(/^ChargePeriodStart,/);

    expect(await run(['report', 'demo.csv', '--budget', '4500'], mem.io)).toBe(0);
    const report = mem.out();
    expect(report).toContain('# Relatório FinOps: 2026-10-22 a 2026-11-20');
    expect(report).toContain('## Anomalias (3)');
    expect(report).toContain('em risco');
    expect(report).toContain('Cobrir o piso de compute com Compute Savings Plan');
  });

  it('sai com código 3 quando há anomalia acima do limite (uso em pipeline)', async () => {
    const mem = memoryIo();
    await run(['demo', '--out', 'demo.csv', '--end', '2026-11-20'], mem.io);
    expect(await run(['report', 'demo.csv', '--fail-on', 'high', '--format', 'json'], mem.io)).toBe(3);
    const json = memoryIo(mem.files);
    expect(await run(['report', 'demo.csv', '--fail-on', 'critical', '--format', 'json'], json.io)).toBe(0);
    expect(JSON.parse(json.out())).toHaveProperty('summary.total');
  });

  it('erros de uso retornam 2 com ajuda; arquivo inexistente retorna 1', async () => {
    const mem = memoryIo();
    expect(await run([], mem.io)).toBe(2);
    expect(await run(['report'], mem.io)).toBe(2);
    expect(await run(['report', 'x.csv', '--format', 'pdf'], mem.io)).toBe(2);
    expect(await run(['report', 'x.csv', '--flag-que-nao-existe'], mem.io)).toBe(2);
    expect(await run(['comando'], mem.io)).toBe(2);
    expect(await run(['report', 'nao-existe.csv'], mem.io)).toBe(1);
    expect(mem.err()).toContain('arquivo não encontrado');
    expect(await run(['--help'], mem.io)).toBe(0);
  });
});
