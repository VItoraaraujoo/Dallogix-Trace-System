import assert from "node:assert/strict";
import test from "node:test";

import { JpegFrameCollector } from "../integracoes/camera-worker/jpeg-frame-collector.mjs";

const JPEG_START = Buffer.from([0xff, 0xd8]);
const JPEG_END = Buffer.from([0xff, 0xd9]);

function jpeg(payload) {
  return Buffer.concat([JPEG_START, Buffer.from(payload), JPEG_END]);
}

test("remonta um JPEG fragmentado e ignora bytes fora do quadro", () => {
  const collector = new JpegFrameCollector(64);
  const expected = jpeg([0x10, 0x20, 0x30]);

  assert.deepEqual(collector.push(Buffer.concat([Buffer.from([0x01, 0x02]), expected.subarray(0, 4)])), []);
  assert.deepEqual(collector.push(Buffer.concat([expected.subarray(4), Buffer.from([0x03])])), [expected]);
});

test("reconhece marcadores SOI e EOI divididos entre chunks", () => {
  const collector = new JpegFrameCollector(64);
  const expected = jpeg([0x41, 0x42]);

  assert.deepEqual(collector.push(Buffer.from([0x00, 0xff])), []);
  assert.deepEqual(collector.push(Buffer.from([0xd8, 0x41, 0xff])), []);
  assert.deepEqual(collector.push(Buffer.concat([Buffer.from([0xd9]), expected])), [
    jpeg([0x41]),
    expected,
  ]);
});

test("emite vários quadros completos recebidos no mesmo chunk", () => {
  const collector = new JpegFrameCollector(64);
  const first = jpeg([0x11]);
  const second = jpeg([0x22, 0x23]);

  assert.deepEqual(collector.push(Buffer.concat([first, Buffer.from([0x00]), second])), [first, second]);
});

test("retém somente o JPEG mais recente de um bloco de quadros", () => {
  const collector = new JpegFrameCollector(64);
  const first = jpeg([0x11]);
  const second = jpeg([0x22, 0x23]);
  const input = Buffer.concat([first, Buffer.from([0x00]), second]);
  const originalConcat = Buffer.concat;
  let concatCalls = 0;
  let latest;

  Buffer.concat = (...args) => {
    concatCalls += 1;
    return originalConcat(...args);
  };
  try {
    latest = collector.pushLatest(input);
  } finally {
    Buffer.concat = originalConcat;
  }

  assert.deepEqual(latest, second);
  assert.equal(concatCalls, 1, "somente o último JPEG deve ser copiado para um buffer novo");
});

test("pushLatest conclui o quadro fragmentado sem expor quadros antigos", () => {
  const collector = new JpegFrameCollector(64);
  const first = jpeg([0x11]);
  const second = jpeg([0x22, 0x23]);

  assert.deepEqual(collector.pushLatest(first), first);
  assert.equal(collector.pushLatest(second.subarray(0, 4)), null);
  assert.deepEqual(collector.pushLatest(second.subarray(4)), second);
});

test("descarta quadro acima do limite e continua com o próximo quadro", () => {
  const collector = new JpegFrameCollector(8);
  const oversized = jpeg(Buffer.alloc(12, 0x31));
  const expected = jpeg([0x55, 0x56]);

  assert.deepEqual(collector.push(Buffer.concat([oversized, expected])), [expected]);
});

test("limpa quadro incompleto excedido e se recupera no chunk seguinte", () => {
  const collector = new JpegFrameCollector(8);
  const expected = jpeg([0x71]);

  assert.deepEqual(collector.push(Buffer.concat([JPEG_START, Buffer.alloc(12, 0x32)])), []);
  assert.deepEqual(collector.push(Buffer.concat([Buffer.alloc(5, 0x00), expected])), [expected]);
});

test("exige limite de memória inteiro e positivo", () => {
  assert.throws(() => new JpegFrameCollector(0), RangeError);
  assert.throws(() => new JpegFrameCollector(1.5), RangeError);
});
