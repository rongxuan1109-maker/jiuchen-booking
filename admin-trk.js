/* v27:病人頁整合治療追蹤 — 左列表+右紀錄卡,同頁填寫/複製/列印 */
(function(){
'use strict';
var THS=['榮軒','維庭','若椏','佩琪','恕愷'];
var THCODE={'榮軒':'軒','維庭':'維','若椏':'椏','佩琪':'王','恕愷':'愷'};
var TX2OPTS=['關節鬆動術','神經鬆動術','軟組織筋膜處理','動作模式調整','運動訓練'];
var HOMEOPTS=['回家多休息','多熱敷','避免激烈運動','非必要不吃止痛藥/消炎藥/感冒藥'];
var TX2OPTS=['關節鬆動術','神經鬆動術','軟組織筋膜處理','動作模式調整','運動訓練'];
window.TRK={sel:null,cv:{},cvIdx:null,pop:null,cal:null,nvDate:'',nvTime:'',msg:'',copied:false,page:0,skipLoad:false};

function db(){ try{return JSON.parse(localStorage.getItem('ptrack_v1'))||{patients:[]};}catch(e){return{patients:[]};} }
function saveDb(d){ localStorage.setItem('ptrack_v1',JSON.stringify(d)); }
function rec(name){ return db().patients.find(function(x){return x.name===name;})||null; }
function today(){ var d=new Date(); return d.getFullYear()+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+String(d.getDate()).padStart(2,'0'); }
function nowHM(){ var d=new Date(); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }
function fmtNv(d,t){ if(!d)return''; var p=d.split('-').map(Number); var wd='日一二三四五六'[new Date(p[0],p[1]-1,p[2]).getDay()]; return p[1]+'/'+p[2]+'('+wd+')'+(t?' '+t:''); }

/* ── 雲端同步層:Supabase treatment_records ↔ localStorage(離線快取) ── */
function genCid(){ return 'c'+Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
function delQ(){ try{return JSON.parse(localStorage.getItem('ptrack_del_v1'))||[];}catch(e){return[];} }
function saveDelQ(a){ localStorage.setItem('ptrack_del_v1',JSON.stringify(a)); }
function sbc(){ return (typeof sb!=='undefined')?sb:null; }
function toRow(name,v){
  var p=(typeof patients!=='undefined'&&patients||[]).find(function(x){return x.name===name;});
  return {cid:v.cid, patient_id:p?p.id:null, patient_name:name,
    date:v.date||'', time:v.time||'', pain_before:v.painBefore==null?'':String(v.painBefore),
    pain_after:v.painAfter==null?'':String(v.painAfter), swelling:v.swelling||'', tx1:v.tx1||'',
    tx2:v.tx2||'', home:v.home||'', next_visit:v.nextVisit||'', therapist:v.therapist||'',
    updated_at:new Date().toISOString()};
}
window.trkPush=function(){
  var c=sbc(); if(!c||!navigator.onLine)return Promise.resolve(false);
  return c.auth.getSession().then(function(s){
    if(!s.data.session)return false;
    var d=db(), rows=[], changed=false;
    d.patients.forEach(function(r){ r.visits.forEach(function(v){
      if(!v.cid){ v.cid=genCid(); v._dirty=1; changed=true; }
      if(v._dirty)rows.push(toRow(r.name,v));
    });});
    if(changed)saveDb(d);
    var q=delQ(), chain=Promise.resolve(), okAll=true;
    if(rows.length)chain=chain.then(function(){ return c.from('treatment_records').upsert(rows,{onConflict:'cid'}); }).then(function(res){
      if(res.error){ okAll=false; return; }
      var done={}; rows.forEach(function(r){done[r.cid]=1;});
      var d2=db(); d2.patients.forEach(function(r){ r.visits.forEach(function(v){ if(v._dirty&&done[v.cid])delete v._dirty; });});
      saveDb(d2);
    });
    if(q.length)chain=chain.then(function(){ return c.from('treatment_records').delete().in('cid',q); }).then(function(res){
      if(res&&res.error){ okAll=false; return; } saveDelQ([]);
    });
    return chain.then(function(){ return okAll; });
  }).catch(function(){ return false; });
};
window.trkPull=function(){
  var c=sbc(); if(!c||!navigator.onLine)return Promise.resolve(false);
  return c.auth.getSession().then(function(s){
    if(!s.data.session)return false;
    return c.from('treatment_records').select('*').order('created_at',{ascending:true}).then(function(res){
      if(res.error||!res.data)return false;
      var pendDel={}; delQ().forEach(function(cid){pendDel[cid]=1;});
      var map={}, d=db();
      res.data.forEach(function(row){
        if(pendDel[row.cid])return;
        if(!map[row.patient_name])map[row.patient_name]={id:row.patient_id||row.id,name:row.patient_name,dx:'',visits:[]};
        map[row.patient_name].visits.push({cid:row.cid,date:row.date||'',time:row.time||'',
          painBefore:row.pain_before||'',painAfter:row.pain_after||'',swelling:row.swelling||'',
          tx1:row.tx1||'',tx2:row.tx2||'',home:row.home||'',nextVisit:row.next_visit||'',therapist:row.therapist||''});
      });
      d.patients.forEach(function(r){ r.visits.forEach(function(v){   /* 沒推上去的髒資料補回,以本機為準 */
        if(!v._dirty)return;
        if(!map[r.name])map[r.name]={id:r.id,name:r.name,dx:r.dx||'',visits:[]};
        var arr=map[r.name].visits, ix=-1;
        for(var i=0;i<arr.length;i++)if(arr[i].cid===v.cid){ix=i;break;}
        if(ix>=0)arr[ix]=v; else arr.push(v);
      });});
      var out={patients:Object.keys(map).map(function(k){
        map[k].visits.sort(function(a,b){ var x=(a.date||'')+' '+(a.time||''), y=(b.date||'')+' '+(b.time||''); return x<y?-1:(x>y?1:0); });
        return map[k];
      })};
      saveDb(out);
      return true;
    });
  }).catch(function(){ return false; });
};
window.trkSync=function(){
  return trkPush().then(function(){ return trkPull(); }).then(function(ok){
    if(!ok)return ok;
    var idle=!TRK.pop&&TRK.cvIdx==null&&!Object.keys(TRK.cv||{}).length;
    if(idle&&document.getElementById('trkPanel'))renderTrkPanel();
    return ok;
  });
};
window.addEventListener('online',function(){ trkSync(); });
setTimeout(function(){
  var c=sbc();
  if(c&&c.auth&&c.auth.onAuthStateChange)c.auth.onAuthStateChange(function(ev){ if(ev==='SIGNED_IN')trkSync(); });
  trkSync();
},800);
setInterval(function(){
  var idle=!TRK.pop&&TRK.cvIdx==null&&!Object.keys(TRK.cv||{}).length;
  if(idle)trkSync();
},60000);

window.trkFromAppt=function(name){
  TRK.sel=name; TRK.cv={}; TRK.cvIdx=null; TRK.pop=null; TRK.msg='';
  var old=document.getElementById('trkModal'); if(old)old.remove();
  var m=document.createElement('div'); m.id='trkModal';
  m.innerHTML='<div onclick="trkCloseModal()" style="position:fixed;inset:0;background:rgba(60,40,20,.4);z-index:150;display:grid;place-items:center;padding:20px">'+
    '<div onclick="event.stopPropagation()" style="background:#f3ece3;border-radius:20px;padding:16px;width:560px;max-width:94vw;max-height:92vh;overflow-y:auto;box-shadow:0 12px 48px rgba(60,40,20,.35)">'+
    '<div style="display:flex;justify-content:flex-end"><button onclick="trkCloseModal()" style="border:none;background:transparent;font-size:18px;color:#8a7361;cursor:pointer">✕</button></div>'+
    '<div id="trkPanel" style="width:100%"></div><div id="trkPop"></div></div></div>';
  document.body.appendChild(m);
  renderTrkPanel();
};
window.trkCloseModal=function(){ var m=document.getElementById('trkModal'); if(m)m.remove(); if(typeof currentView!=='undefined'&&currentView==='patients'&&typeof renderPatients==='function')renderPatients(); };
window.trkSelect=function(name){ TRK.sel=name; TRK.cv={}; TRK.cvIdx=null; TRK.pop=null; TRK.msg=''; renderTrkPanel(); markSel(); };
window.trkPage=function(d){ TRK.page=(TRK.page||0)+d; TRK.skipLoad=true; renderPatients(); };
setTimeout(function(){ var _ds=window.debouncedSearch;
  if(typeof _ds==='function'&&!_ds._trkWrapped){ window.debouncedSearch=function(v){ TRK.page=0; _ds(v); }; window.debouncedSearch._trkWrapped=true; } },0);
function markSel(){ document.querySelectorAll('.trk-pt').forEach(function(el){ el.style.background = el.dataset.name===TRK.sel ? '#fdf1e6' : '#fff'; }); }

/* ── 覆寫病人頁 ── */
window.renderPatients=function(){
  var el=document.getElementById('mainContent');
  var skip=TRK.skipLoad&&typeof patients!=='undefined'&&patients.length; TRK.skipLoad=false;
  if(!skip)el.innerHTML='<div class="loading"><div class="spinner"></div><p>載入中</p></div>';
  (skip?Promise.resolve():Promise.all([loadPatients(),loadPatientVisits()])).then(function(){
    var filtered=patients.filter(patientPassFilters);
    if(TRK.sel==null&&filtered.length)TRK.sel=filtered[0].name;
    var PAGE=50, totalPages=Math.max(1,Math.ceil(filtered.length/PAGE));
    if(TRK.page==null||TRK.page<0)TRK.page=0;
    if(TRK.page>=totalPages)TRK.page=totalPages-1;
    var pageItems=filtered.slice(TRK.page*PAGE,TRK.page*PAGE+PAGE);
    var recChip=function(v,label){ var on=recencyFilter===v; return '<div onclick="recencyFilter=\''+v+'\';TRK.page=0;renderPatients()" style="padding:3px 10px;font-size:11px;cursor:pointer;border-radius:99px;border:1px solid '+(on?'#c2571f':'var(--border)')+';background:'+(on?'#fdf1e6':'#fff')+';color:'+(on?'#c2571f':'var(--muted)')+';font-weight:700">'+label+'</div>'; };
    var partChip=function(v,label){ var on=partFilter===v; return '<div onclick="partFilter=\''+v+'\';TRK.page=0;renderPatients()" style="padding:3px 10px;font-size:11px;cursor:pointer;border-radius:99px;border:1px solid '+(on?'#c98a2e':'var(--border)')+';background:'+(on?'#faf0dd':'#fff')+';color:'+(on?'#a5701f':'var(--muted)')+';font-weight:700">'+label+'</div>'; };
    el.innerHTML=
    '<div style="display:grid;grid-template-columns:280px 320px minmax(0,1fr);gap:20px;padding:0 24px 20px;align-items:stretch;max-width:1400px;margin:0 auto;height:calc(100vh - 180px)">'+
      '<div style="display:flex;flex-direction:column;min-height:0">'+
        '<div style="background:#fff;border:1px solid #f0e6da;border-radius:14px;padding:12px;margin-bottom:10px;box-shadow:0 1px 4px rgba(120,80,40,.06)">'+
          '<div style="display:flex;gap:6px;margin-bottom:8px">'+
            '<input id="ptSearch" placeholder="搜尋姓名或電話…" value="'+esc(patientFilter)+'" oninput="debouncedSearch(this.value)" style="flex:1;min-width:0;border:1.5px solid #eee3d4;border-radius:10px;padding:7px 10px;font-size:13px;font-family:\'Noto Sans TC\',sans-serif;outline:none;background:#fff">'+
            '<button onclick="openNewPatient()" style="padding:7px 12px;background:#c2571f;color:#fff;border:none;border-radius:10px;font-size:12px;font-weight:900;cursor:pointer;font-family:\'Noto Sans TC\',sans-serif;white-space:nowrap">＋ 新增</button>'+
          '</div>'+
          '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px"><span style="font-size:10px;color:var(--muted);align-self:center">最近</span>'+recChip('','全部')+recChip('3','3個月')+recChip('6','6個月')+recChip('12','一年')+'</div>'+
          '<div style="display:flex;gap:4px;flex-wrap:wrap"><span style="font-size:10px;color:var(--muted);align-self:center">部位</span>'+partChip('','全部')+BODY_PARTS.map(function(p){return partChip(p,p);}).join('')+'</div>'+
        '</div>'+
        '<div style="font-size:11px;color:var(--muted);margin:0 2px 8px">共 '+filtered.length+' 位病人'+(totalPages>1?' · 第 '+(TRK.page+1)+' / '+totalPages+' 頁':'')+'</div>'+
        '<div style="max-height:calc(100vh - 300px);overflow-y:auto;display:flex;flex-direction:column;gap:6px">'+
        (filtered.length?pageItems.map(function(p){
          var r=rec(p.name); var n=r?r.visits.length:0;
          return '<div class="trk-pt" data-name="'+esc(p.name)+'" onclick="trkSelect(\''+esc(p.name).replace(/'/g,'')+'\')" style="background:#fff;border:1px solid #f0e6da;border-radius:12px;padding:10px 12px;cursor:pointer">'+
            '<div style="display:flex;justify-content:space-between;align-items:baseline"><b style="font-size:13px">'+esc(p.name)+'</b><span style="font-size:10px;color:#b3a08c">'+(n?n+' 次紀錄':'')+'</span></div>'+
            '<div style="font-size:11px;color:#a08b76;margin-top:1px">'+esc(p.phone||'無電話')+(p.body_parts&&p.body_parts.length?' · '+p.body_parts.join('/'):'')+'</div>'+
          '</div>';
        }).join(''):'<div style="text-align:center;padding:30px;color:var(--muted)">沒有符合條件的病人</div>')+
        '</div>'+
        (totalPages>1?'<div style="display:flex;gap:8px;justify-content:center;align-items:center;margin-top:8px">'+
          '<button onclick="trkPage(-1)" '+(TRK.page<=0?'disabled style="opacity:.4;cursor:default;':'style="cursor:pointer;')+'padding:5px 14px;border:1.5px solid #eee3d4;border-radius:10px;background:#fff;color:#8a7361;font-size:12px;font-weight:700;font-family:\'Noto Sans TC\',sans-serif">‹ 上一頁</button>'+
          '<span style="font-size:11px;color:var(--muted);font-weight:700">'+(TRK.page+1)+' / '+totalPages+'</span>'+
          '<button onclick="trkPage(1)" '+(TRK.page>=totalPages-1?'disabled style="opacity:.4;cursor:default;':'style="cursor:pointer;')+'padding:5px 14px;border:1.5px solid #eee3d4;border-radius:10px;background:#fff;color:#8a7361;font-size:12px;font-weight:700;font-family:\'Noto Sans TC\',sans-serif">下一頁 ›</button>'+
        '</div>':'')+
      '</div>'+
      '<div id="trkHistory"></div><div id="trkPanel" style="width:100%"></div>'+
    '</div><div id="trkPop"></div>';
    renderTrkPanel(); markSel();
  });
};

/* ── 右側:紀錄卡+歷史 ── */
window.renderTrkPanel=function(){
  var el=document.getElementById('trkPanel'); if(!el)return;
  if(!TRK.sel){ el.innerHTML='<div style="text-align:center;padding:60px;color:#b3a08c">從左側選擇病患</div>'; var he0=document.getElementById('trkHistory'); if(he0)he0.innerHTML=''; return; }
  var p=patients.find(function(x){return x.name===TRK.sel;});
  var r=rec(TRK.sel); var visits=r?r.visits:[];
  var cv=TRK.cv;
  var pb=Number(cv.painBefore),pa=Number(cv.painAfter);
  var ok=cv.painBefore!=null&&cv.painBefore!==''&&cv.painAfter!=null&&cv.painAfter!==''&&!isNaN(pb)&&!isNaN(pa);
  var delta='—',cheer='點疼痛卡選分數';
  if(ok&&pa<pb){delta='▼ '+(pb>0?Math.round((pb-pa)/pb*100)+'%':(pb-pa));cheer='疼痛減輕了!';}
  else if(ok&&pa===pb){delta='持平';cheer='慢慢來,穩住!';}
  else if(ok){delta='▲ '+(pa-pb);cheer='回去多休息';}
  var sw=['無','輕度','中度','重度'].map(function(s){
    var on=s===cv.swelling;
    return '<div onclick="trkSet(\'swelling\',\''+s+'\')" style="flex:1;text-align:center;font-size:11px;font-weight:700;padding:4px 0;border-radius:99px;background:'+(on?'#c98a2e':'#f4ece1')+';color:'+(on?'#fff':'#b3a08c')+';cursor:pointer">'+s+'</div>';
  }).join('');
  var hist=visits.length?visits.slice().reverse().map(function(v,ri){
    var i=visits.length-1-ri;
    var pain=(v.painBefore!==''&&v.painAfter!=='')?'<span style="background:#fdeae3;color:#c14a28;padding:1px 8px;border-radius:99px;font-weight:700;font-size:11px">疼痛 '+v.painBefore+'→'+v.painAfter+'</span>':'';
    var swb=v.swelling?'<span style="background:#faf0dd;color:#a5701f;padding:1px 8px;border-radius:99px;font-weight:700;font-size:11px">腫脹:'+esc(v.swelling)+'</span>':'';
    var body=[v.tx1&&('震波:'+v.tx1),v.tx2&&('徒手:'+v.tx2),v.home&&('回家:'+v.home)].filter(Boolean).join('\n');
    return '<div style="background:#fff;border:1px solid #f0e6da;border-radius:12px;padding:10px 12px">'+
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b style="font-size:12px">'+esc(v.date||'')+'</b>'+pain+swb+
      '<span style="margin-left:auto;display:flex;gap:6px">'+
      '<button onclick="trkView('+i+')" style="border:1.5px solid #c98a2e;background:#fff;color:#a5701f;border-radius:8px;padding:2px 10px;font-size:11px;font-weight:700;cursor:pointer">檢視</button>'+
      '<button onclick="trkPrint('+i+')" style="border:1.5px solid #c2571f;background:#fff;color:#c2571f;border-radius:8px;padding:2px 10px;font-size:11px;font-weight:700;cursor:pointer">列印</button>'+
      '<button onclick="trkDel('+i+')" style="border:none;background:transparent;color:#c0ad98;font-size:11px;cursor:pointer">刪除</button></span></div>'+
      (body?'<div style="font-size:12px;color:#6b5643;margin-top:5px;line-height:1.6;white-space:pre-wrap">'+esc(body)+'</div>':'')+
    '</div>';
  }).join(''):'<div style="font-size:12px;color:#b3a08c">尚無治療紀錄</div>';
  el.innerHTML=
  '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px;flex-wrap:wrap">'+
    '<div><b style="font-size:17px">'+esc(TRK.sel)+'</b><span style="font-size:12px;color:#a08b76;margin-left:8px">'+esc(p&&p.phone||'')+' · 共 '+visits.length+' 次紀錄</span></div>'+
    '<div style="display:flex;gap:6px">'+
      (p?'<button onclick="editPatientOld('+p.id+')" style="padding:7px 12px;border:1.5px solid #e3d5c3;border-radius:10px;background:#fff;color:#8a7361;font-size:12px;font-weight:700;cursor:pointer">編輯基本資料</button>':'')+
      '<button onclick="trkNew()" style="padding:7px 14px;border:none;border-radius:10px;background:#c2571f;color:#fff;font-size:12px;font-weight:900;cursor:pointer">＋ 填寫今日治療紀錄</button>'+
    '</div>'+
  '</div>'+
  '<div style="background:#fdf8f1;border:1px solid #f0e6da;border-radius:16px;padding:12px;display:flex;flex-direction:column;gap:8px;max-width:460px;aspect-ratio:105/148.5;max-height:calc(100vh - 320px);overflow-y:auto;box-shadow:0 3px 14px rgba(120,80,40,.12)">'+
    '<div style="background:#c2571f;border-radius:12px;padding:7px 12px;color:#fff;display:flex;justify-content:space-between;align-items:center"><b style="font-size:14px;letter-spacing:1px">治療紀錄卡</b><span style="font-size:12px;font-weight:700">'+(TRK.cvIdx!=null?'檢視/編輯 '+esc(visits[TRK.cvIdx]&&visits[TRK.cvIdx].date||''):today())+'</span></div>'+
    '<div style="display:flex;gap:6px">'+
      '<div onclick="trkPop(\'pb\')" style="flex:1;background:#fff;border-radius:12px;padding:6px 8px;text-align:center;cursor:pointer;box-shadow:0 1px 4px rgba(120,80,40,.1)"><div style="font-size:11px;color:#a08b76;font-weight:700">疼痛 · 前</div><div style="font-size:20px;font-weight:900;color:#c14a28">'+(cv.painBefore===''||cv.painBefore==null?'－':cv.painBefore)+'<span style="font-size:10px;color:#c0ad98;font-weight:400"> /10</span></div></div>'+
      '<div style="align-self:center;font-size:15px;color:#c2571f;font-weight:900">➜</div>'+
      '<div onclick="trkPop(\'pa\')" style="flex:1;background:#fff;border-radius:12px;padding:6px 8px;text-align:center;cursor:pointer;box-shadow:0 1px 4px rgba(120,80,40,.1)"><div style="font-size:11px;color:#a08b76;font-weight:700">疼痛 · 後</div><div style="font-size:20px;font-weight:900;color:#38795a">'+(cv.painAfter===''||cv.painAfter==null?'－':cv.painAfter)+'<span style="font-size:10px;color:#c0ad98;font-weight:400"> /10</span></div></div>'+
      '<div style="flex:1.1;background:#e4f2ea;border-radius:12px;padding:6px 8px;text-align:center;display:flex;flex-direction:column;justify-content:center"><div style="font-size:13px;font-weight:900;color:#38795a">'+delta+'</div><div style="font-size:10px;color:#5a8a72">'+cheer+'</div></div>'+
    '</div>'+
    '<div style="background:#fff;border-radius:12px;padding:6px 10px;box-shadow:0 1px 4px rgba(120,80,40,.1);display:flex;align-items:center;gap:8px"><b style="font-size:12px">腫脹</b><div style="display:flex;gap:4px;flex:1">'+sw+'</div></div>'+
    '<div style="background:#fff;border-radius:12px;padding:8px 10px;box-shadow:0 1px 4px rgba(120,80,40,.1)">'+
      '<div style="font-size:12px;font-weight:900;color:#8a4a1c">✦ 今天治療師為你做了</div>'+
      '<div style="display:flex;align-items:baseline;gap:5px;margin-top:5px"><span style="background:#faf0dd;color:#a5701f;font-size:10px;font-weight:900;padding:1px 8px;border-radius:99px;white-space:nowrap">震波治療</span><input value="'+esc(cv.tx1||'')+'" oninput="trkSetQ(\'tx1\',this.value)" placeholder="發數、部位" style="flex:1;border:none;border-bottom:1px dashed #e3d5c3;background:transparent;font-size:12px;padding:0;outline:none;font-family:\'Noto Sans TC\',sans-serif"></div>'+
      '<div onclick="trkPop(\'tx2\')" style="display:flex;align-items:baseline;gap:5px;margin-top:6px;cursor:pointer;min-height:40px"><span style="background:#fdeae3;color:#c14a28;font-size:10px;font-weight:900;padding:1px 8px;border-radius:99px;white-space:nowrap">徒手治療</span><div style="flex:1;border-bottom:1px dashed #e3d5c3;font-size:12px;line-height:1.5;white-space:pre-wrap;color:#3d3026">'+(esc(cv.tx2||'')||'<span style=\'color:#c9b8a4\'>點此選擇/填寫</span>')+'</div></div>'+
    '</div>'+
    '<div onclick="trkPop(\'home\')" style="background:#fbe6d2;border-radius:12px;padding:8px 10px;cursor:pointer;min-height:44px"><div style="font-size:12px;font-weight:900;color:#8a4a1c">🏠 回家小任務 <span style="font-weight:400;font-size:10px;color:#b3906a">點此選擇/填寫</span></div><div style="font-size:12px;margin-top:3px;line-height:1.6;color:#5c452f;white-space:pre-wrap">'+esc(cv.home||'')+'</div></div>'+
    '<div style="display:flex;gap:6px">'+
      '<div onclick="trkPop(\'nv\')" style="flex:1.4;background:#fff;border-radius:12px;padding:6px 10px;cursor:pointer;box-shadow:0 1px 4px rgba(120,80,40,.1)"><div style="font-size:10px;color:#a08b76;font-weight:700">下次見面</div><div style="font-size:13px;font-weight:900;margin-top:1px">'+(cv.nextVisit||'點此選擇')+'</div></div>'+
      '<div onclick="trkPop(\'th\')" style="flex:1;background:#fff;border-radius:12px;padding:6px 10px;cursor:pointer;box-shadow:0 1px 4px rgba(120,80,40,.1)"><div style="font-size:10px;color:#a08b76;font-weight:700">你的治療師</div><div style="font-size:13px;font-weight:900;margin-top:1px">'+(cv.therapist||'點此選擇')+'</div></div>'+
    '</div>'+
    '<div style="text-align:center;font-size:10px;color:#b3906a;margin-top:auto">每一次進步,都值得被看見 ♡ 九辰物理治療所</div>'+
  '</div>'+
  '<div style="display:flex;gap:8px;margin-top:10px;max-width:460px">'+
    '<button onclick="trkSave()" style="flex:1.2;padding:11px;border:none;border-radius:10px;background:#c2571f;color:#fff;font-size:14px;font-weight:900;cursor:pointer">儲存紀錄</button>'+
    '<button onclick="trkCopy()" style="flex:1;padding:11px;border:1.5px solid #c2571f;border-radius:10px;background:#fff;color:#c2571f;font-size:13px;font-weight:900;cursor:pointer">'+(TRK.copied?'✓ 已複製':'📋 複製到診所系統')+'</button>'+
    '<button onclick="trkSavePrint()" style="flex:1;padding:11px;border:1.5px solid #c2571f;border-radius:10px;background:#fff;color:#c2571f;font-size:13px;font-weight:900;cursor:pointer">🖨 儲存並列印</button>'+
  '</div>'+
  '<div style="font-size:12px;color:#b3a08c;margin:6px 2px 10px">'+esc(TRK.msg)+'</div>';
  var hel=document.getElementById('trkHistory');
  if(hel)hel.innerHTML='<div style="font-size:12px;font-weight:900;color:#8a7361;margin:2px 2px 8px">歷史紀錄（'+visits.length+' 次）</div>'+
    '<div style="flex:1;display:flex;flex-direction:column;gap:8px;overflow-y:auto;padding-right:4px;min-height:0">'+hist+'</div>';
};

window.trkSet=function(k,v){ TRK.cv[k]=v; renderTrkPanel(); };
window.trkSetQ=function(k,v){ TRK.cv[k]=v; };  /* 打字不重繪 */
window.trkNew=function(){ TRK.cv={}; TRK.cvIdx=null; TRK.msg=''; renderTrkPanel(); };
window.trkView=function(i){ var r=rec(TRK.sel); if(!r||!r.visits[i])return; var v=r.visits[i];
  TRK.cv={painBefore:v.painBefore||'',painAfter:v.painAfter||'',swelling:v.swelling||'',tx1:v.tx1||'',tx2:v.tx2||'',home:v.home||'',nextVisit:v.nextVisit||'',therapist:v.therapist||''};
  TRK.cvIdx=i; TRK.msg='正在檢視/編輯 '+(v.date||'')+' 的紀錄'; renderTrkPanel(); };
window.trkDel=function(i){ if(!confirm('刪除這筆紀錄?'))return; var d=db(); var r=d.patients.find(function(x){return x.name===TRK.sel;}); if(!r)return;
  var v=r.visits[i]; if(v&&v.cid){ var q=delQ(); q.push(v.cid); saveDelQ(q); }
  r.visits.splice(i,1); saveDb(d); trkPush(); if(TRK.cvIdx===i)trkNew(); else renderTrkPanel(); };
window.trkSave=function(){
  var d=db(); var r=d.patients.find(function(x){return x.name===TRK.sel;});
  if(!r){ r={id:Date.now(),name:TRK.sel,dx:'',visits:[]}; d.patients.push(r); }
  if(TRK.cvIdx!=null&&r.visits[TRK.cvIdx]){ Object.assign(r.visits[TRK.cvIdx],TRK.cv,{_dirty:1}); if(!r.visits[TRK.cvIdx].cid)r.visits[TRK.cvIdx].cid=genCid(); TRK.msg='已更新紀錄 ✓'; }
  else{ r.visits.push(Object.assign({date:today(),time:nowHM(),cid:genCid(),_dirty:1},TRK.cv)); TRK.cvIdx=r.visits.length-1; TRK.msg='已儲存 '+today()+' 的紀錄 ✓'; }
  saveDb(d); renderTrkPanel(); markSel();
  var savedIdx=TRK.cvIdx;
  trkPush().then(function(ok){ if(ok&&TRK.msg&&TRK.msg.indexOf('✓')>=0&&TRK.msg.indexOf('雲端')<0){ TRK.msg=TRK.msg+'（已同步雲端）'; renderTrkPanel(); } });
  return savedIdx;
};
window.trkCopy=function(){
  var cv=TRK.cv;
  var code=THCODE[cv.therapist]||'';
  var t0=new Date(); var md=(t0.getMonth()+1)+'/'+t0.getDate();
  var tidy=function(s){return s.replace(/[ \t\u3000]+/g,' ').trim();};
  var tx1Line='';
  if(cv.tx1){ var t=tidy(cv.tx1); var m=t.match(/^(\d+)\s*(.*)$/); tx1Line=m?(' EMS '+m[1]+' /(療程) '+m[2]).replace(/\s+$/,''):(' EMS '+t); }
  var lines=[(md+' '+code+tx1Line).trim(),'評估：',''];
  lines.push('今日腫脹程度：'+(cv.swelling||''));
  if(cv.painBefore&&cv.painAfter!==''&&cv.painAfter!=null)lines.push('今日治療後疼痛'+cv.painBefore+'>'+cv.painAfter+'分');
  if(cv.tx2)cv.tx2.split('\n').map(tidy).filter(Boolean).forEach(function(l){lines.push(l);});
  var text=lines.join('\n');
  var ok=function(){ TRK.copied=true; renderTrkPanel(); setTimeout(function(){TRK.copied=false;renderTrkPanel();},2000); };
  var fb=function(){ var ta=document.createElement('textarea'); ta.value=text; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select();
    var done=false; try{done=document.execCommand('copy');}catch(e){} document.body.removeChild(ta); if(done)ok(); else alert('複製失敗,請手動複製:\n\n'+text); };
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(text).then(ok,fb); else fb();
};
window.trkPrint=function(i){ var r=rec(TRK.sel); if(!r||!r.visits[i])return; doPrintCard(r.visits[i],i+1); };
window.trkSavePrint=function(){ var idx=trkSave(); var r=rec(TRK.sel); if(idx==null||!r)return; doPrintCard(r.visits[idx],idx+1); };
function doPrintCard(v,no){
  var area=document.getElementById('a6print')||(function(){var d=document.createElement('div');d.id='a6print';document.body.appendChild(d);return d;})();
  var pain=(v.painBefore!==''&&v.painAfter!=='')?v.painBefore:null;
  var pct=''; var pb=Number(v.painBefore),pa=Number(v.painAfter);
  if(!isNaN(pb)&&!isNaN(pa)&&pb>0&&pa<pb)pct='▼ 減輕 '+Math.round((pb-pa)/pb*100)+'%';
  area.innerHTML=
  '<div style="width:105mm;height:148.5mm;box-sizing:border-box;padding:7mm;background:#fdf8f1;font-family:\'Noto Sans TC\',sans-serif;color:#3d3026;display:flex;flex-direction:column;gap:2.4mm">'+
    '<div style="background:#c2571f;border-radius:3mm;padding:2mm 3.5mm;color:#fff;display:flex;justify-content:space-between;align-items:center"><b style="font-size:12.5pt;letter-spacing:1px">治療紀錄卡</b><span style="font-size:8.5pt">九辰物理治療所</span></div>'+
    '<div style="display:flex;gap:4mm;font-size:9pt"><span>姓名:<b>'+esc(TRK.sel)+'</b></span><span>日期:<b>'+esc(v.date||'')+'</b></span><span>第 <b>'+no+'</b> 次</span></div>'+
    '<div style="display:flex;gap:2.4mm">'+
      '<div style="flex:1;background:#fff;border-radius:3mm;padding:1.6mm 2mm;text-align:center"><div style="font-size:7.5pt;color:#a08b76;font-weight:700">疼痛 · 前</div><div style="font-size:16pt;font-weight:900;color:#c14a28">'+(v.painBefore===''?'－':esc(v.painBefore))+'<span style="font-size:7pt;color:#c0ad98;font-weight:400"> /10</span></div></div>'+
      '<div style="align-self:center;font-size:11pt;color:#c2571f;font-weight:900">➜</div>'+
      '<div style="flex:1;background:#fff;border-radius:3mm;padding:1.6mm 2mm;text-align:center"><div style="font-size:7.5pt;color:#a08b76;font-weight:700">疼痛 · 後</div><div style="font-size:16pt;font-weight:900;color:#38795a">'+(v.painAfter===''?'－':esc(v.painAfter))+'<span style="font-size:7pt;color:#c0ad98;font-weight:400"> /10</span></div></div>'+
      (pct?'<div style="flex:1.1;background:#e4f2ea;border-radius:3mm;padding:1.6mm 2mm;text-align:center;display:flex;flex-direction:column;justify-content:center"><div style="font-size:10pt;font-weight:900;color:#38795a">'+pct+'</div><div style="font-size:7pt;color:#5a8a72">疼痛減輕了!</div></div>':'')+
    '</div>'+
    '<div style="background:#fff;border-radius:3mm;padding:1.6mm 3mm;display:flex;align-items:center;gap:3mm"><b style="font-size:9pt">腫脹</b><span style="font-size:9.5pt;font-weight:700;color:#a5701f">'+esc(v.swelling||'—')+'</span><span style="font-size:7pt;color:#8a7361">(與健側比較)</span></div>'+
    '<div style="background:#fff;border-radius:3mm;padding:2mm 3mm;flex:1">'+
      '<div style="font-size:9.5pt;font-weight:900;color:#8a4a1c">✦ 今天治療師為你做了</div>'+
      (v.tx1?'<div style="display:flex;gap:2mm;margin-top:1.6mm;align-items:baseline"><span style="background:#faf0dd;color:#a5701f;font-size:7.5pt;font-weight:900;padding:0 2.4mm;border-radius:99px;white-space:nowrap">震波治療</span><span style="font-size:9pt">'+esc(v.tx1)+'</span></div>':'')+
      (v.tx2?'<div style="display:flex;gap:2mm;margin-top:1.6mm;align-items:baseline"><span style="background:#fdeae3;color:#c14a28;font-size:7.5pt;font-weight:900;padding:0 2.4mm;border-radius:99px;white-space:nowrap">徒手治療</span><span style="font-size:9pt;white-space:pre-wrap;line-height:1.5">'+esc(v.tx2)+'</span></div>':'')+
      (!v.tx1&&!v.tx2?'<div style="font-size:8.5pt;color:#8a7361;margin-top:1.6mm">(本次以運動治療為主)</div>':'')+
    '</div>'+
    '<div style="background:#fbe6d2;border-radius:3mm;padding:2mm 3mm;min-height:18mm"><div style="font-size:9.5pt;font-weight:900;color:#8a4a1c">🏠 回家小任務</div><div style="font-size:9pt;margin-top:1mm;white-space:pre-wrap;line-height:1.6;color:#5c452f">'+esc(v.home||' ')+'</div></div>'+
    '<div style="display:flex;gap:2.4mm">'+
      '<div style="flex:1.4;background:#fff;border-radius:3mm;padding:1.6mm 3mm"><div style="font-size:7.5pt;color:#a08b76;font-weight:700">下次見面</div><div style="font-size:10pt;font-weight:900">'+esc(v.nextVisit||'＿＿')+'</div></div>'+
      '<div style="flex:1;background:#fff;border-radius:3mm;padding:1.6mm 3mm"><div style="font-size:7.5pt;color:#a08b76;font-weight:700">你的治療師</div><div style="font-size:10pt;font-weight:900">'+esc(v.therapist||'＿＿')+'</div></div>'+
    '</div>'+
    '<div style="text-align:center;font-size:7.5pt;color:#b3906a">每一次進步,都值得被看見 ♡ 請保留本卡追蹤自己的復原</div>'+
  '</div>';
  document.body.classList.add('printing-card');
  var done=function(){ document.body.classList.remove('printing-card'); window.removeEventListener('afterprint',done); };
  window.addEventListener('afterprint',done);
  setTimeout(function(){window.print();},80);
}

/* ── 彈出選單 ── */
window.trkPop=function(kind){ TRK.pop=kind; if(kind==='nv'&&!TRK.cal){var n=new Date();TRK.cal={y:n.getFullYear(),m:n.getMonth()};} renderPop(); };
window.trkClosePop=function(){ TRK.pop=null; renderPop(); renderTrkPanel(); };
window.trkPickPain=function(k,n){ TRK.cv[k]=String(n); trkClosePop(); };
window.trkPickTh=function(t){ TRK.cv.therapist=t; trkClosePop(); };
window.trkTx2Chip=function(t){ var cur=TRK.cv.tx2||''; var on=cur.indexOf(t)>=0;
  TRK.cv.tx2=on?cur.split('\n').filter(function(l){return l.trim()!==t;}).join('\n'):(cur?cur.replace(/\n?$/,'\n'):'')+t; renderPop(); };
window.trkTx2Text=function(v){ TRK.cv.tx2=v; };
window.trkHomeChip=function(t){ var cur=TRK.cv.home||''; var on=cur.indexOf(t)>=0;
  TRK.cv.home=on?cur.split('\n').filter(function(l){return l.trim()!==t;}).join('\n'):(cur?cur.replace(/\n?$/,'\n'):'')+t; renderPop(); };
window.trkHomeText=function(v){ TRK.cv.home=v; };
window.trkTx2Chip=function(t){ var cur=TRK.cv.tx2||''; var on=cur.indexOf(t)>=0;
  TRK.cv.tx2=on?cur.split('\n').filter(function(l){return l.trim()!==t;}).join('\n'):(cur?cur.replace(/\n?$/,'\n'):'')+t; renderPop(); };
window.trkTx2Text=function(v){ TRK.cv.tx2=v; };
window.trkCalNav=function(d){ var c=TRK.cal; var m=c.m+d; TRK.cal=m<0?{y:c.y-1,m:11}:(m>11?{y:c.y+1,m:0}:{y:c.y,m:m}); renderPop(); };
window.trkPickDate=function(iso){ TRK.nvDate=iso; TRK.cv.nextVisit=fmtNv(iso,TRK.nvTime); renderPop(); };
window.trkPickTime=function(t){ TRK.nvTime=t; TRK.cv.nextVisit=fmtNv(TRK.nvDate,t); renderPop(); };
window.renderPop=function(){
  var el=document.getElementById('trkPop'); if(!el)return;
  if(!TRK.pop){ el.innerHTML=''; return; }
  var inner='';
  var titles={pb:'疼痛分數 · 治療前',pa:'疼痛分數 · 治療後',th:'你的治療師',nv:'下次見面時間',home:'🏠 回家小任務',tx2:'徒手治療'};
  if(TRK.pop==='pb'||TRK.pop==='pa'){
    var k=TRK.pop==='pb'?'painBefore':'painAfter'; var on=TRK.pop==='pb'?'#c14a28':'#38795a';
    inner='<div style="display:flex;gap:6px;flex-wrap:wrap">'+Array.from({length:11},function(_,n){
      var sel=String(n)===String(TRK.cv[k]);
      return '<div onclick="trkPickPain(\''+k+'\','+n+')" style="min-width:44px;text-align:center;font-size:15px;font-weight:700;padding:10px 12px;border-radius:10px;cursor:pointer;background:'+(sel?on:'#f4ece1')+';color:'+(sel?'#fff':'#6b5643')+'">'+n+'</div>';
    }).join('')+'</div>';
  } else if(TRK.pop==='th'){
    inner='<div style="display:flex;gap:6px;flex-wrap:wrap">'+THS.map(function(t){
      var sel=t===TRK.cv.therapist;
      return '<div onclick="trkPickTh(\''+t+'\')" style="min-width:44px;text-align:center;font-size:15px;font-weight:700;padding:10px 12px;border-radius:10px;cursor:pointer;background:'+(sel?'#c2571f':'#f4ece1')+';color:'+(sel?'#fff':'#6b5643')+'">'+t+'</div>';
    }).join('')+'</div>';
  } else if(TRK.pop==='tx2'){
    inner='<div style="font-size:12px;color:#a08b76;font-weight:700;margin-bottom:6px">常用手法(可複選)</div>'+
      '<div style="display:flex;gap:6px;flex-wrap:wrap">'+TX2OPTS.map(function(t){
        var on=(TRK.cv.tx2||'').indexOf(t)>=0;
        return '<div onclick="trkTx2Chip(\''+t+'\')" style="font-size:13px;font-weight:700;padding:8px 14px;border-radius:99px;cursor:pointer;border:1px solid #f0cfc0;background:'+(on?'#c14a28':'#fff')+';color:'+(on?'#fff':'#a05840')+'">'+t+'</div>';
      }).join('')+'</div>'+
      '<div style="font-size:12px;color:#a08b76;font-weight:700;margin:12px 0 6px">補充說明(部位、細節)</div>'+
      '<textarea oninput="trkTx2Text(this.value)" rows="4" placeholder="如:左肩 放鬆後側關節囊…" style="width:100%;box-sizing:border-box;border:1.5px solid #e3d5c3;border-radius:10px;padding:8px 10px;font-size:13px;resize:vertical;line-height:1.6;outline:none;font-family:\'Noto Sans TC\',sans-serif">'+esc(TRK.cv.tx2||'')+'</textarea>'+
      '<button onclick="trkClosePop()" style="margin-top:12px;width:100%;padding:10px;border:none;border-radius:10px;background:#c2571f;color:#fff;font-size:14px;font-weight:900;cursor:pointer">完成</button>';
  } else if(TRK.pop==='tx2'){
    inner='<div style="font-size:12px;color:#a08b76;font-weight:700;margin-bottom:6px">常用項目(可複選)</div>'+
      '<div style="display:flex;gap:6px;flex-wrap:wrap">'+TX2OPTS.map(function(t){
        var on=(TRK.cv.tx2||'').indexOf(t)>=0;
        return '<div onclick="trkTx2Chip(\''+t+'\')" style="font-size:13px;font-weight:700;padding:8px 14px;border-radius:99px;cursor:pointer;border:1px solid #f0c9ba;background:'+(on?'#c14a28':'#fff')+';color:'+(on?'#fff':'#a05237')+'">'+t+'</div>';
      }).join('')+'</div>'+
      '<div style="font-size:12px;color:#a08b76;font-weight:700;margin:12px 0 6px">補充說明(部位、手法細節)</div>'+
      '<textarea oninput="trkTx2Text(this.value)" rows="4" placeholder="如:左肩 放鬆後側關節囊…" style="width:100%;box-sizing:border-box;border:1.5px solid #e3d5c3;border-radius:10px;padding:8px 10px;font-size:13px;resize:vertical;line-height:1.6;outline:none;font-family:\'Noto Sans TC\',sans-serif">'+esc(TRK.cv.tx2||'')+'</textarea>'+
      '<button onclick="trkClosePop()" style="margin-top:12px;width:100%;padding:10px;border:none;border-radius:10px;background:#c2571f;color:#fff;font-size:14px;font-weight:900;cursor:pointer">完成</button>';
  } else if(TRK.pop==='home'){
    inner='<div style="font-size:12px;color:#a08b76;font-weight:700;margin-bottom:6px">常用衛教(可複選)</div>'+
      '<div style="display:flex;gap:6px;flex-wrap:wrap">'+HOMEOPTS.map(function(t){
        var on=(TRK.cv.home||'').indexOf(t)>=0;
        return '<div onclick="trkHomeChip(\''+t.replace(/'/g,'')+'\')" style="font-size:13px;font-weight:700;padding:8px 14px;border-radius:99px;cursor:pointer;border:1px solid #ecd3b8;background:'+(on?'#c98a2e':'#fff')+';color:'+(on?'#fff':'#8a6a45')+'">'+t+'</div>';
      }).join('')+'</div>'+
      '<div style="font-size:12px;color:#a08b76;font-weight:700;margin:12px 0 6px">補充說明</div>'+
      '<textarea oninput="trkHomeText(this.value)" rows="4" placeholder="其他注意事項、運動處方…" style="width:100%;box-sizing:border-box;border:1.5px solid #e3d5c3;border-radius:10px;padding:8px 10px;font-size:13px;resize:vertical;line-height:1.6;outline:none;font-family:\'Noto Sans TC\',sans-serif">'+esc(TRK.cv.home||'')+'</textarea>'+
      '<button onclick="trkClosePop()" style="margin-top:12px;width:100%;padding:10px;border:none;border-radius:10px;background:#c2571f;color:#fff;font-size:14px;font-weight:900;cursor:pointer">完成</button>';
  } else if(TRK.pop==='nv'){
    var y=TRK.cal.y,m=TRK.cal.m;
    var first=new Date(y,m,1).getDay(),days=new Date(y,m+1,0).getDate();
    var n=new Date(); var todayIso=n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0')+'-'+String(n.getDate()).padStart(2,'0');
    var cells='';
    for(var i=0;i<first;i++)cells+='<div></div>';
    for(var d=1;d<=days;d++){
      var iso=y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
      var past=iso<todayIso,sel=iso===TRK.nvDate;
      cells+='<div '+(past?'':'onclick="trkPickDate(\''+iso+'\')"')+' style="text-align:center;font-size:13px;font-weight:700;padding:7px 0;border-radius:8px;cursor:'+(past?'default':'pointer')+';background:'+(sel?'#c2571f':(iso===todayIso?'#fbe6d2':'#faf6f1'))+';color:'+(sel?'#fff':(past?'#d8cbbb':'#3d3026'))+'">'+d+'</div>';
    }
    var times='';
    for(var t=0;t<25;t++){ var h=8+Math.floor(t/2),mm=t%2?'30':'00'; var tt=String(h).padStart(2,'0')+':'+mm; var ts=tt===TRK.nvTime;
      times+='<div onclick="trkPickTime(\''+tt+'\')" style="text-align:center;font-size:12px;font-weight:700;padding:6px 0;border-radius:8px;cursor:pointer;background:'+(ts?'#c2571f':'#f4ece1')+';color:'+(ts?'#fff':'#6b5643')+'">'+tt+'</div>'; }
    inner='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'+
      '<button onclick="trkCalNav(-1)" style="width:32px;height:32px;border:1px solid #e3d5c3;border-radius:10px;background:#fff;color:#8a7361;font-size:14px;cursor:pointer">‹</button>'+
      '<b style="font-size:15px">'+y+' 年 '+(m+1)+' 月</b>'+
      '<button onclick="trkCalNav(1)" style="width:32px;height:32px;border:1px solid #e3d5c3;border-radius:10px;background:#fff;color:#8a7361;font-size:14px;cursor:pointer">›</button></div>'+
      '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:2px">'+'日一二三四五六'.split('').map(function(w){return '<div style="text-align:center;font-size:11px;color:#a08b76;font-weight:700;padding:3px 0">'+w+'</div>';}).join('')+'</div>'+
      '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px">'+cells+'</div>'+
      '<div style="font-size:12px;color:#a08b76;font-weight:700;margin:12px 0 6px">時間</div>'+
      '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:5px">'+times+'</div>'+
      '<button onclick="trkClosePop()" style="margin-top:14px;width:100%;padding:10px;border:none;border-radius:10px;background:#c2571f;color:#fff;font-size:14px;font-weight:900;cursor:pointer">完成</button>';
  }
  el.innerHTML='<div onclick="trkClosePop()" style="position:fixed;inset:0;background:rgba(60,40,20,.35);z-index:200;display:grid;place-items:center">'+
    '<div onclick="event.stopPropagation()" style="background:#fff;border-radius:18px;padding:20px;width:440px;max-width:92vw;max-height:85vh;overflow-y:auto;box-shadow:0 10px 40px rgba(60,40,20,.3);font-family:\'Noto Sans TC\',sans-serif">'+
    '<div style="font-size:15px;font-weight:900;margin-bottom:12px;color:#3d3026">'+titles[TRK.pop]+'</div>'+inner+'</div></div>';
};
})();
