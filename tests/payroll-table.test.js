import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pdfScanText, readPayslip, NOT_CHECKED } from '../src/model/scan.js';
import { payrollItems } from '../e2e/payroll-table.mjs';
const read = (opts) => readPayslip(pdfScanText(payrollItems(opts)), '2026-10-23', {allowHistorical:true});
const sum = (a) => a.reduce((s,l)=>s+l.amount,0);
test('blank summary cell stays zero and all earnings reconcile',()=>{
  const r=read(); assert.equal(r.error,undefined); assert.equal(sum(r.earnings),1700000);
  assert.equal(r.printed_gross,1700000);assert.equal(r.printed_net,1520000);assert.equal(r.printed_deductions,180000);
});
test('explicit zero after-tax summary is equivalent to blank',()=>{
  const r=read({blank:false});assert.equal(r.printed_deductions,180000);assert.equal(sum(r.earnings),1700000);
});
test('side by side sections survive reversed content-stream order',()=>{
  const r=read({reverse:true}); assert.equal(sum(r.earnings),1700000);assert.equal(sum(r.deductions),180000);
  assert.deepEqual(r,read());
});
test('YTD and accrual figures never contribute to this period',()=>{
  const r=read();assert.equal(sum(r.earnings),1700000);assert.deepEqual(r,read({ytd:false}));
});
test('zero and changed hours do not replace money',()=>{
  const r=read({hours:'999.00'});assert.equal(sum(r.earnings),1700000);assert.equal(r.earnings.find(l=>l.kind==='other').amount,250000);
});
test('retro and non-taxable lines count without changing saved categories',()=>{
  const r=read();assert.equal(r.earnings.find(l=>l.kind==='other')?.amount,250000);
  assert.equal(r.earnings.find(l=>l.kind==='basic')?.amount,1200000);
  assert.equal(r.earnings.find(l=>l.kind==='overtime')?.amount,250000);
});
test('all three deduction sections reconcile independently',()=>{
  const r=read({after:true});assert.equal(r.printed_deductions,200000);assert.equal(sum(r.deductions),200000);
  assert.equal(r.printed_net,1500000);assert.equal(r.deposit,1500000);
});
test('distribution is read independently and employer/date labels stay separate',()=>{
  const r=read();assert.equal(r.deposit,1520000);assert.equal(r.employer,'Example Employer Ltd');
  assert.equal(r.pay_date,'2026-01-16');assert.equal(r.period_from,'2026-01-01');assert.equal(r.period_to,'2026-01-15');
});
// The reader never refuses a recognised table (owner, Oct 29): it fills its best reading and says what the arithmetic did not prove.
// Hand-worked: earnings 12,000.00 + 2,500.00 + 2,500.00 = 17,000.00 (centavos 1700000); deductions 1,200.00 + 600.00 = 1,800.00; net 15,200.00.
const flagOf = (r, field) => r.flags.filter(f => f.field === field).map(f => f.reason);
test('a clean table is fully proven: no flags and no unread rows',()=>{
  const r=read();assert.deepEqual(r.flags,[]);assert.deepEqual(r.unread,{earning:0,deduction:0});assert.equal(r.error,undefined);
});
test('a wrong printed gross is filled as printed and flagged with the difference',()=>{
  const r=read({change:a=>{a.find(i=>i.y===640&&i.str==='17,000.00').str='18,000.00';}});
  assert.equal(r.error,undefined);assert.equal(r.printed_gross,1800000);assert.equal(sum(r.earnings),1700000);
  assert.deepEqual(flagOf(r,'gross'),['earnings add up to 1,000.00 less than the printed gross']);
});
test('a deduction section that differs from its printed total is flagged, the lines are kept',()=>{
  const r=read({change:a=>{a.find(i=>i.y===640&&i.str==='1,200.00').str='1,100.00';a.find(i=>i.y===640&&i.str==='600.00').str='700.00';}});
  assert.equal(sum(r.deductions),180000);assert.equal(r.printed_deductions,180000);
  assert.deepEqual(flagOf(r,'deductions'),['the pre-tax deduction lines add up to 100.00 more than the printed total','the tax lines add up to 100.00 less than the printed total']);
});
test('a printed net that differs from gross less deductions is filled and flagged',()=>{
  const r=read({change:a=>{for(const i of a.filter(i=>i.str==='15,200.00'))i.str='15,300.00';}});
  assert.equal(r.printed_net,1530000);assert.equal(r.deposit,1530000);
  assert.deepEqual(flagOf(r,'net'),['gross less deductions is 100.00 less than the printed net pay']);
});
test('a distribution that differs from the net is filled as read and flagged',()=>{
  const r=read({change:a=>{a.find(i=>i.y===345&&i.str==='15,200.00').str='15,100.00';}});
  assert.equal(r.printed_net,1520000);assert.equal(r.deposit,1510000);
  assert.deepEqual(flagOf(r,'deposit'),['the account distribution is 100.00 less than the printed net pay']);
});
test('an unreadable earnings amount: every other field is filled, the row is counted, gross is flagged with the missing amount',()=>{
  const r=read({change:a=>{a.find(i=>i.str==='12,000.00').str='12,OOO.OO';}});
  assert.equal(r.error,undefined);assert.deepEqual(r.unread,{earning:1,deduction:0});
  assert.equal(r.printed_gross,1700000);assert.equal(r.printed_net,1520000);assert.equal(r.deposit,1520000);assert.equal(sum(r.deductions),180000);
  assert.equal(sum(r.earnings),500000);assert.equal(r.earnings.find(l=>l.kind==='basic'),undefined,'the unreadable line is not guessed');
  assert.deepEqual(flagOf(r,'gross'),['earnings add up to 12,000.00 less than the printed gross']);
});
test('a missing section is said, the lines read are kept and the deduction totals are flagged',()=>{
  const r=read({change:a=>{a.find(i=>i.str==='Tax Deductions').str='Unclear heading';}});
  assert.equal(r.error,undefined);assert.equal(sum(r.earnings),1700000);
  assert.ok(flagOf(r,'structure').some(x=>/taxes section was not found/.test(x)));
  assert.ok(r.unread.deduction>=1,'the unclear heading row is counted as an unread row');
  assert.ok(flagOf(r,'deductions').length>=1);
});
test('nothing the old refusal covered returns an error or empties the form',()=>{
  const cases=[a=>{a.find(i=>i.y===640&&i.str==='17,000.00').str='18,000.00';},a=>{a.find(i=>i.str==='12,000.00').str='12,OOO.OO';},a=>{a.find(i=>i.str==='Tax Deductions').str='Unclear heading';}];
  for(const change of cases){const r=read({change});assert.equal(r.error,undefined);assert.ok(r.earnings.length>0&&r.deductions.length>0&&r.printed_net>0&&r.deposit>0);}
});
// Owner, Nov 1: a check compares only with what the page prints. An unreadable printed gross stays EMPTY (never what the earnings add up to) and the payslip is not checked.
test('an unreadable printed gross stays empty, is said, and the payslip is not checked',()=>{
  const r=read({change:a=>{a.find(i=>i.y===640&&i.str==='17,000.00').str='17,0O0.00';}});
  assert.equal(r.error,undefined);assert.equal(r.printed_gross,null);assert.equal(sum(r.earnings),1700000);
  assert.deepEqual(flagOf(r,'gross'),['the printed gross could not be read']);
  assert.ok(r.notes.includes(NOT_CHECKED));
});
