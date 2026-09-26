// The shared queue: who sees which job, per-account limits, and turns between accounts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Jobs} from '../lib/engine.mjs';

function queue(list,options){
  const jobs=new Jobs(null,options);
  list.forEach(([id,owner,status='queued'],i)=>jobs.jobs.set(id,{id,owner,status,name:id,mode:'quick',done:0,total:1,created:String(i)}));
  return jobs;
}

test('jobs take turns between accounts instead of first come, first served',()=>{
  const jobs=queue([['a1','a','running'],['a2','a'],['a3','a'],['b1','b'],['c1','c']]);
  jobs.lastStart.set('a',3);
  assert.deepEqual(jobs.waiting().map(j=>j.id),['a1','b1','c1','a2','a3']);
  assert.equal(jobs.next([...jobs.jobs.values()].filter(j=>j.status==='queued')).id,'b1');
});

test('without accounts the queue keeps creation order',()=>{
  const jobs=queue([['x',undefined],['y',undefined],['z',undefined]]);
  assert.deepEqual(jobs.waiting().map(j=>j.id),['x','y','z']);
});

test('other accounts’ jobs are masked, and admins see everything',()=>{
  const jobs=queue([['a1','a','running'],['b1','b']]);
  const forB=jobs.activeJobs({id:'b'});
  assert.deepEqual(forB.map(j=>j.id),[null,'b1']);
  assert.equal(forB[0].name,'Another user');
  assert.deepEqual(jobs.activeJobs({id:'x',admin:true}).map(j=>j.id),['a1','b1']);
  assert.deepEqual(jobs.activeJobs().map(j=>j.id),['a1','b1'],'the desktop app has no viewer and sees all');
  assert.equal(jobs.queueFor(jobs.jobs.get('b1'),{id:'b'}).ahead[0].name,'Another user');
  assert.equal(jobs.visible(jobs.jobs.get('a1'),{id:'b'}),false);
});

test('an account cannot fill the queue on its own',async()=>{
  const jobs=queue([['a1','a','running'],['a2','a']],{limit:20,perOwner:2});
  await assert.rejects(jobs.add({},{},'a'),/already have 2 jobs/);
  const full=queue([['a1','a'],['b1','b']],{limit:2,perOwner:5});
  await assert.rejects(full.add({},{},'c'),/queue is full/);
});
