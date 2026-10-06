import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const compose = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
const productionTest = readFileSync(new URL("../docker-compose.production-test.yml", import.meta.url), "utf8");

test("prepara armazenamento antes de iniciar o PHP restrito", () => {
  assert.match(compose, /armazenamento-init:/);
  assert.match(compose, /chown -R 82:82 \/var\/www\/armazenamento/);
  assert.match(compose, /\.trace-write-probe/);
  assert.match(compose, /php:[\s\S]*?armazenamento-init:[\s\S]*?service_completed_successfully/);
  assert.match(compose, /php:[\s\S]*?user: "82:82"/);
});

test("homologação reproduz a mesma permissão do PHP de produção", () => {
  assert.match(productionTest, /armazenamento-init:/);
  assert.match(productionTest, /chown -R 82:82 \/var\/www\/armazenamento/);
  assert.match(productionTest, /\.trace-write-probe/);
  assert.match(productionTest, /php:[\s\S]*?user: "82:82"/);
  assert.match(productionTest, /php:[\s\S]*?armazenamento-init:[\s\S]*?service_completed_successfully/);
});
