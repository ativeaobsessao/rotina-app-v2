import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TIMEZONE,
  getLocalDateString,
  getCurrentLocalTime,
  shiftDateString,
  getWeekdayName,
  formatFriendlyDate,
  formatTime,
  formatDateToTime,
} from '../src/utils/date.ts';

test('DEFAULT_TIMEZONE is America/Sao_Paulo', () => {
  assert.equal(DEFAULT_TIMEZONE, 'America/Sao_Paulo');
});

test('getLocalDateString and getCurrentLocalTime handle Sao Paulo midnight accurately', () => {
  // 02:59:59 UTC == 23:59:59 in America/Sao_Paulo (-03:00), still previous day!
  const beforeMidnightSP = new Date('2026-11-15T02:59:59.000Z');
  assert.equal(getLocalDateString('America/Sao_Paulo', beforeMidnightSP), '2026-11-14');
  assert.equal(getCurrentLocalTime('America/Sao_Paulo', beforeMidnightSP), '23:59:59');

  // 03:00:05 UTC == 00:00:05 in America/Sao_Paulo (-03:00), next day!
  const afterMidnightSP = new Date('2026-11-15T03:00:05.000Z');
  assert.equal(getLocalDateString('America/Sao_Paulo', afterMidnightSP), '2026-11-15');
  assert.equal(getCurrentLocalTime('America/Sao_Paulo', afterMidnightSP), '00:00:05');
});

test('shiftDateString performs pure calendar math across month and leap boundaries', () => {
  assert.equal(shiftDateString('2026-11-15', 1), '2026-11-16');
  assert.equal(shiftDateString('2026-11-01', -1), '2026-10-31');
  assert.equal(shiftDateString('2024-02-28', 1), '2024-02-29'); // leap year
  assert.equal(shiftDateString('2024-02-29', 1), '2024-03-01');
  assert.equal(shiftDateString('2026-01-01', -1), '2025-12-31');
});

test('getWeekdayName returns exact English weekday matching DB weekly medication rules', () => {
  assert.equal(getWeekdayName('2026-11-15'), 'Sunday');
  assert.equal(getWeekdayName('2026-11-16'), 'Monday');
  assert.equal(getWeekdayName('2026-11-21'), 'Saturday');
});

test('formatDateToTime converts UTC timestamps to America/Sao_Paulo consistently', () => {
  // 01:30 UTC == 22:30 in Sao Paulo (-03:00)
  const lateNightSP = '2026-11-15T01:30:00.000Z';
  assert.equal(formatDateToTime(lateNightSP, 'America/Sao_Paulo'), '22h:30min');

  assert.equal(formatTime('08:05:00'), '08h:05min');
  assert.match(formatFriendlyDate('2026-11-15'), /domingo/i);
});
