import test from 'node:test';
import assert from 'node:assert/strict';

import { __test__ } from '../api/handler.js';

test('parseMskDateTimeToUtcMs converts Moscow time to UTC ms', () => {
  const ms = __test__.parseMskDateTimeToUtcMs('2026-04-02', '09:00');
  assert.equal(ms, Date.UTC(2026, 3, 2, 6, 0, 0, 0));
});

test('bookingEndUtcMs uses booking date and slotTo fallback', () => {
  const ms = __test__.bookingEndUtcMs({ date: '2026-04-02', slotTo: '17:30' });
  assert.equal(ms, Date.UTC(2026, 3, 2, 14, 30, 0, 0));
});

test('timesOverlap detects overlaps correctly', () => {
  assert.equal(__test__.timesOverlap('09:00', '12:00', '11:00', '13:00'), true);
  assert.equal(__test__.timesOverlap('09:00', '12:00', '12:00', '13:00'), false);
  assert.equal(__test__.timesOverlap('10:00', '11:00', '08:00', '10:00'), false);
});

test('normalizeSpace validates required fields and normalizes values', () => {
  const normalized = __test__.normalizeSpace({
    id: 's1',
    floorId: 'f1',
    label: 'Desk 1',
    seats: 2,
    x: '15.5',
    y: '22.1',
    w: '10',
    h: '8',
    color: '#00aa00',
  });
  assert.deepEqual(normalized, {
    id: 's1',
    floorId: 'f1',
    label: 'Desk 1',
    seats: 2,
    x: 15.5,
    y: 22.1,
    w: 10,
    h: 8,
    color: '#00aa00',
  });
});

test('parseCsvRow supports quoted values and escaped quotes', () => {
  const row = __test__.parseCsvRow('name,email,department,"Head, Office","say ""hi"""');
  assert.deepEqual(row, ['name', 'email', 'department', 'Head, Office', 'say "hi"']);
});

test('parseCsvText parses header and values', () => {
  const rows = __test__.parseCsvText('\uFEFFname,email,department,role\nIvan Ivanov,ivan@company.ru,IT,manager');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Ivan Ivanov');
  assert.equal(rows[0].email, 'ivan@company.ru');
  assert.equal(rows[0].department, 'IT');
  assert.equal(rows[0].role, 'manager');
});
