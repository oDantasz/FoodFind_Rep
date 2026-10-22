const test = require('node:test');
const assert = require('node:assert/strict');

function validRating(value) { return Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 5; }
function validDiscount(type, value) { value = Number(value); return Number.isFinite(value) && value > 0 && (type !== 'percent' || value <= 100); }
function validPeriod(start, end) { return Number.isFinite(Date.parse(start)) && Number.isFinite(Date.parse(end)) && Date.parse(end) > Date.parse(start); }

test('HU2.2c: aceita notas inteiras de 1 a 5', () => {
  for (const n of [1,2,3,4,5]) assert.equal(validRating(n), true);
});
test('HU2.2c: rejeita notas fora da faixa ou fracionárias', () => {
  for (const n of [0,6,-1,2.5,'abc','']) assert.equal(validRating(n), false);
});
test('HU3.2: valida descontos percentuais e fixos', () => {
  assert.equal(validDiscount('percent', 15), true);
  assert.equal(validDiscount('percent', 100), true);
  assert.equal(validDiscount('percent', 101), false);
  assert.equal(validDiscount('fixed', 12.5), true);
  assert.equal(validDiscount('fixed', 0), false);
});
test('HU3.2: fim da campanha precisa ser posterior ao início', () => {
  assert.equal(validPeriod('2026-10-01T10:00:00Z','2026-10-02T10:00:00Z'), true);
  assert.equal(validPeriod('2026-10-02T10:00:00Z','2026-10-01T10:00:00Z'), false);
  assert.equal(validPeriod('data inválida','2026-10-02T10:00:00Z'), false);
});
