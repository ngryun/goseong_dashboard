const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/app.js', 'utf8');
const split = source.indexOf('document.addEventListener(');
const snapshot = {updated_at:'2026-10-09T12:00:00Z',sources:[{id:'sheet'}],events:[
  {id:'sheet-event',date:'2026-10-09',kind:'monthly',title:'원본 일정',team:''}
]};
const schoolSnapshot = {schools:[{code:'a'}],events:[]};

function harness({blockedStorage=false}={}){
  const requests=[],timers=new Map(),listeners=new Map(),nodes=new Map(),preferences=new Map();
  let timerId=0, renders=0;
  function node(key){
    if(!nodes.has(key))nodes.set(key,{
      value:'',textContent:'',hidden:false,disabled:false,options:[{value:''},{value:'총무팀'}],
      attributes:{},classList:{toggle(){},contains(){return false;}},
      src:'http://localhost/app.js?v=test',
      setAttribute(k,v){this.attributes[k]=String(v);},getAttribute(k){return this.attributes[k]??null;},removeAttribute(k){delete this.attributes[k];},focus(){},
      addEventListener(type,fn){listeners.set(`${key}:${type}`,fn);},querySelectorAll(){return [];}
    });
    return nodes.get(key);
  }
  node('#editor-form').elements=new Proxy({}, {get:(_,key)=>node(`field:${key}`)});
  const document={hidden:false,body:node('body'),querySelector:node,querySelectorAll:()=>[],
    addEventListener:(type,fn)=>listeners.set(`document:${type}`,fn)};
  const context=vm.createContext({Intl,Date,URL,AbortController,console,document,
    window:{matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener:(type,fn)=>listeners.set(`window:${type}`,fn)},
    location:{hash:'#month/%E0%A4%A',reload(){context.reloaded=true;}},history:{},
    localStorage:{getItem(key){if(blockedStorage)throw Error('Storage blocked');return preferences.get(key)||null;},
      setItem(key,value){if(blockedStorage)throw Error('Storage full');preferences.set(key,value);}},
    setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id;},
    clearTimeout:id=>timers.delete(id),setInterval:()=>0,
    fetch(url,{signal}){return new Promise((resolve,reject)=>{
      const request={url,resolve,reject,signal};requests.push(request);
      signal.addEventListener('abort',()=>reject(Error('Request timed out')),{once:true});
    });},
    recordRender:()=>renders++
  });
  const run=code=>vm.runInContext(code,context);
  run(source.slice(0,split));
  // Rendering is already covered by calendar tests; observe refresh behavior without a browser layout engine.
  run('render=()=>recordRender();renderSources=()=>{};fitMonth=()=>{};');
  // The only external integration excluded from this harness is the live Firestore subscription.
  run(source.slice(split).replace(/connectFirestore\(\);\s*$/,''));
  function respond(batch,overrides={}){
    const payloads={'data.json':snapshot,'status.json':{checked_at:new Date().toISOString(),ok:true},
      'version.json':{'app.js':'test'},'schools.json':schoolSnapshot,...overrides};
    for(const request of batch){
      const value=payloads[request.url.split('?')[0]];
      if(value instanceof Error)request.reject(value);
      else request.resolve({ok:value!==undefined,status:value===undefined?404:200,json:async()=>structuredClone(value)});
    }
  }
  return {run,context,node,requests,timers,listeners,respond,renders:()=>renders};
}

(async()=>{
  const h=harness({blockedStorage:true});
  assert.equal(h.requests.length,4,'malformed route and blocked storage must not prevent initial loading');
  assert.equal(h.renders(),1,'the calendar shell renders before network requests finish');
  assert.equal(h.run('view'),'month');
  const first=h.run('load()');
  assert.equal(h.run('load()'),first,'concurrent refreshes share the same result');
  assert.equal(h.requests.length,4);
  assert.equal(h.node('#refresh').disabled,true);
  assert.equal(h.node('#refresh').attributes['aria-busy'],'true');
  h.run('fsEvents=[{id:"direct-event",date:"2026-10-09",title:"직접 입력",kind:"monthly"}];');
  h.respond(h.requests);await first;
  assert.equal(h.run('data.events.map(e=>e.id).join()'),'sheet-event,direct-event','refresh preserves live Firestore events');
  assert.equal(h.node('#refresh').disabled,false);
  assert.equal(h.node('#refresh').attributes['aria-busy'],undefined);
  assert.equal(h.timers.size,0,'completed requests clear timeouts');
  assert.doesNotThrow(()=>h.run('theme(true)'));
  assert.ok(h.run('clientId().length>0 && clientId()===clientId()'),'blocked storage still has a stable session client id');

  h.node('#team').value='총무팀';
  const previousStatus=h.run('status');
  const second=h.run('load()');
  h.respond(h.requests.slice(4),{'status.json':new Error('offline'),'schools.json':{schools:[]}});
  await second;
  assert.equal(h.node('#team').value,'총무팀','refresh keeps the selected team');
  assert.equal(h.run('status'),previousStatus,'an optional status failure keeps the last known sync time');
  assert.equal(h.run('schools.schools.length'),1,'an incomplete school response preserves the last snapshot');

  const previous=h.run('data');
  const third=h.run('load()');
  h.respond(h.requests.slice(8),{'data.json':{events:null,sources:[]}});await third;
  assert.equal(h.run('data'),previous,'invalid responses must not replace usable events');
  assert.match(h.node('#notice-body').textContent,/기존에 불러온 일정은 유지/);
  assert.equal(h.node('#notice-summary').textContent,'일정을 불러오지 못했습니다');
  assert.equal(h.node('#refresh').disabled,false,'failed refresh can be retried');

  const fourth=h.run('load()');
  assert.ok([...h.timers.values()].every(t=>t.ms===15000));
  for(const {fn} of [...h.timers.values()])fn();
  await fourth;
  assert.ok(h.requests.slice(12).every(r=>r.signal.aborted),'stalled requests are aborted');
  assert.equal(h.run('data'),previous);
  assert.equal(h.node('#refresh').disabled,false,'timeout releases the refresh button');
  assert.equal(h.timers.size,0);

  h.context.document.hidden=true;
  h.listeners.get('document:visibilitychange')();
  assert.equal(h.requests.length,16,'hidden tabs do not refresh');
  h.context.document.hidden=false;
  h.listeners.get('document:visibilitychange')();
  h.listeners.get('window:online')();
  assert.equal(h.requests.length,20,'returning to the tab refreshes; reconnect shares an active refresh');
  h.respond(h.requests.slice(16));await h.run('pendingLoad');
  assert.equal(h.node('#notice-body').textContent,'','a successful retry clears the error');
  assert.equal(h.node('#notice').hidden,true);

  h.run('selected="2026-10-23";cursor=parseDate("2026-10-01");');
  h.listeners.get('document:click')({target:{closest:selector=>selector==='[data-view]'?{dataset:{view:'week'}}:null}});
  assert.equal(h.run('dateKey(weekStart(cursor))'),'2026-10-19','switching to weekly view follows the selected day');

  const initialFailure=harness();
  initialFailure.respond(initialFailure.requests,{'data.json':new Error('offline')});
  await initialFailure.run('pendingLoad');
  assert.match(initialFailure.node('#sync-label').textContent,/불러오지 못했습니다/,'initial failure does not leave an endless loading label');
  initialFailure.listeners.get('document:click')({target:{closest:selector=>selector==='[data-week-layout]'?{dataset:{weekLayout:'list'}}:null}});
  assert.equal(initialFailure.run('readPreference("goseong-week-layout")'),'list','remember the explicit week layout choice');
  initialFailure.listeners.get('document:click')({target:{closest:selector=>selector==='[data-week-density]'?{}:null}});
  assert.equal(initialFailure.run('readPreference("goseong-week-compact")'),'true','remember the compact table choice');
  initialFailure.node('#toggle-filters').onclick();
  assert.equal(initialFailure.node('#toggle-filters').attributes['aria-expanded'],'true');
  initialFailure.node('#toggle-filters').onclick();
  assert.equal(initialFailure.node('#toggle-filters').attributes['aria-expanded'],'false');
  console.log('Refresh concurrency, timeout, retry, tab return, snapshot retention, storage fallback and selected-week navigation verified.');
})().catch(error=>{console.error(error);process.exitCode=1;});
