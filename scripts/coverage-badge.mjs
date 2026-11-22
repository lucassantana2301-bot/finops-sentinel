#!/usr/bin/env node
// Gera o JSON do badge de cobertura (formato endpoint do shields.io) a partir do
// coverage-summary.json do Istanbul/V8. Uso: node coverage-badge.mjs <summary.json> <saida.json>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const [summaryPath, outPath] = process.argv.slice(2);
if (!summaryPath || !outPath) {
  console.error('uso: coverage-badge.mjs <coverage-summary.json> <saida.json>');
  process.exit(2);
}

const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
const pct = Number(summary?.total?.lines?.pct);
if (!Number.isFinite(pct)) {
  console.error(`resumo de cobertura inválido em ${summaryPath}`);
  process.exit(1);
}

const color =
  pct >= 90 ? 'brightgreen' : pct >= 80 ? 'green' : pct >= 70 ? 'yellowgreen' : pct >= 60 ? 'yellow' : 'red';
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  `${JSON.stringify({ schemaVersion: 1, label: 'coverage', message: `${pct.toFixed(1)}%`, color })}\n`,
);
console.log(`cobertura de linhas: ${pct.toFixed(1)}% -> ${outPath}`);
