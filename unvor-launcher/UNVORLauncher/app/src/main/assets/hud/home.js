'use strict';
(() => {
 const native = window.UltronNative;
 const preview = !native;
 const fixture = new URLSearchParams(location.search).has('preview');
 if (preview && fixture) document.body.classList.add('preview');
 const $ = id => document.getElementById(id);
 const paths = {
 phone:'M32 24l11 16-9 9c5 12 11 18 23 23l9-9 12 10c-1 10-8 14-16 12-23-6-43-26-47-47-1-7 5-13 17-14z',
 message:'M24 29h52v38H49L34 79V67H24z M33 41h34 M33 51h25',
 apps:'M28 28h15v15H28z M57 28h15v15H57z M28 57h15v15H28z M57 57h15v15H57z',
 folder:'M22 34h22l8 9h27v31H22z M22 34V26h25l8 9h24v8',
 shield:'M50 22c11 8 19 9 25 10v20c-2 16-11 24-25 32-14-8-23-16-25-32V32c6-1 14-2 25-10z M36 51l10 10 19-22',
 wifi:'M20 41q30-25 60 0 M30 53q20-17 40 0 M40 65q10-9 20 0 M50 77h.1',
 tools:'M30 31L68 70 M69 30L31 71 M23 24l15 2-2 15-14-2z M62 60l14 2-2 15-14-2z M64 24l12 6-5 11-13-6z M24 62l12-3 6 12-13 5z',
 settings:'M43 24h14l3 10 9 4 10-2 7 12-8 7-1 10 7 8-8 12-10-4-9 5-4 10H41l-3-10-9-5-10 4-7-12 7-8-1-10-8-7 7-12 10 2 9-4z M50 42a13 13 0 1 0 .1 0z',
 globe:'M50 20a30 30 0 1 0 .1 0z M20 50h60 M50 20c-19 17-19 43 0 60 M50 20c19 17 19 43 0 60 M25 36h50 M25 64h50',
 helmet:'M50 19L73 31l-3 37-20 16-20-16-3-37z M32 45l13 8 M55 53l13-8 M44 76l1-14h10l1 14 M50 21v21',
 search:'M42 20a23 23 0 1 0 .1 0z M59 60l23 23',
 mic:'M40 17a10 10 0 0 1 20 0v30a10 10 0 0 1-20 0z M28 40v8a22 22 0 0 0 44 0v-8 M50 70v17 M38 87h24',
 cloud:'M27 73a17 17 0 0 1-3-33 26 26 0 0 1 50-2 18 18 0 0 1 0 35z',
 ram:'M24 24h52v50H24z M31 34h38v12H31z M33 58v9 M43 58v9 M53 58v9 M63 58v9 M33 76v7 M48 76v7 M63 76v7',
 storage:'M31 26h38v47H31z M38 34h24v13H38z M40 56h.1 M40 65h20 M21 35h10 M21 47h10 M69 35h10 M69 47h10 M40 16v10 M57 16v10 M40 73v10 M57 73v10',
 battery:'M40 20h20v9h10v52H30V29h10z M38 44h24v28H38z'
 };
 let serial=0;
 function icon(kind, plain=false) {
  const id='g'+(++serial);
  if(kind==='drawer') return `<svg class="icon" viewBox="0 0 100 100" aria-hidden="true"><defs><radialGradient id="${id}"><stop stop-color="#063b50"/><stop offset="1" stop-color="#00070c"/></radialGradient></defs><circle cx="50" cy="50" r="44" fill="url(#${id})" stroke="#01c9f4" stroke-width="2"/><circle cx="50" cy="50" r="39" fill="none" stroke="#7debff" stroke-width=".7"/><path d="M50 3a47 47 0 0 1 47 47M3 50a47 47 0 0 0 47 47" fill="none" stroke="#11d7ff" stroke-width="4"/>${[35,50,65].flatMap(y=>[35,50,65].map(x=>`<circle cx="${x}" cy="${y}" r="3.3" fill="#d5f9ff"/>`)).join('')}</svg>`;
  return `<svg class="icon" viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#4ddfff"/><stop offset=".3" stop-color="#06425d"/><stop offset=".7" stop-color="#00111c"/><stop offset="1" stop-color="#3ed7fb"/></linearGradient><linearGradient id="${id}f" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#062c40"/><stop offset=".5" stop-color="#00090e"/><stop offset="1" stop-color="#022a3f"/></linearGradient><linearGradient id="${id}i" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f1fdff"/><stop offset="1" stop-color="#17d7ff"/></linearGradient><filter id="${id}b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2"/></filter></defs>${plain?'':`<path d="M24 5H76L95 24V76L76 95H24L5 76V24z" fill="url(#${id})" stroke="#00c9f2" stroke-width="1"/><path d="M25 10H75L90 25V75L75 90H25L10 75V25z" fill="url(#${id}f)" stroke="#15647a" stroke-width=".8"/><path d="M24 5H76L91 20M5 28V76L20 91" fill="none" stroke="#b8f4ff" stroke-width=".65" opacity=".8"/>`}<path d="${paths[kind]||paths.apps}" fill="${kind==='phone'?'url(#'+id+'i)':'none'}" stroke="#00d2ff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" filter="url(#${id}b)" opacity=".65"/><path d="${paths[kind]||paths.apps}" fill="${kind==='phone'?'url(#'+id+'i)':'none'}" stroke="url(#${id}i)" stroke-width="${plain?4:3.4}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
 }
 function frame() {return '<svg class="frame" viewBox="0 0 320 180" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="panelFill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#001018" stop-opacity=".9"/><stop offset=".55" stop-color="#000306" stop-opacity=".88"/><stop offset="1" stop-color="#00101c" stop-opacity=".94"/></linearGradient></defs><path d="M20 3H300L317 20V160L300 177H20L3 160V20z" fill="url(#panelFill)" stroke="#12d2fa" stroke-width=".9" vector-effect="non-scaling-stroke"/><path d="M25 9H296L311 24V156L296 171H24L9 156V24z" fill="none" stroke="#095b78" stroke-width=".7" vector-effect="non-scaling-stroke"/><path d="M3 38V20L20 3H77 M244 177H300L317 160V128 M25 9H128 M9 130v26l15 15" fill="none" stroke="#8cefff" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>';}
 document.querySelectorAll('[data-icon]').forEach(el=>{el.innerHTML=icon(el.dataset.icon,el.closest('.dock,.information') || ['cloud','search','mic'].includes(el.dataset.icon));});
 document.querySelectorAll('.glass').forEach(el=>el.insertAdjacentHTML('afterbegin',frame()));
 const searchToggle=$('toggle-search'), voicePrompt=document.querySelector('.voice-prompt');
 function searchMode(enabled){
   $('query').hidden=!enabled;voicePrompt.hidden=enabled;
   searchToggle.setAttribute('aria-expanded',String(enabled));
   searchToggle.setAttribute('aria-label',enabled?'Chiudi ricerca Internet':'Apri ricerca Internet');
   if(enabled)$('query').focus();
 }
 searchToggle.onclick=()=>searchMode($('query').hidden);
 $('query').addEventListener('keydown',event=>{if(event.key==='Escape'){searchMode(false);searchToggle.focus();}});
 let state={},mode=null,selection=null,apps=[],timer=null,longTarget=null,toastTimer,previousFocus;
 let personalAiState=null,aiResults={},aiPending=false;
 function dispatch(action,payload={}) {
  if (native) { try { native.action(action,JSON.stringify(payload)); } catch { toast('Comando non disponibile'); } }
  else toast('Collegamento Android non disponibile');
 }
 function toast(text) { $('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3500); }
 function show(title) { if(native)dispatch('panel',{open:true});previousFocus=document.activeElement;$('home').inert=true;mode=title; $('dialog-title').textContent=title;$('dialog-content').replaceChildren();$('dialog-content').classList.remove('planner-content');$('overlay').hidden=false;$('close').focus(); }
 function close() {if(native)dispatch('panel',{open:false});$('overlay').hidden=true;$('home').inert=false;selection=null;mode=null;previousFocus?.focus?.();return true;}
 function paragraph(text) {const p=document.createElement('p');p.textContent=text;$('dialog-content').append(p);}
 function menu(text,fn) {const b=document.createElement('button');b.className='menu-item';b.textContent=text;b.onclick=fn;$('dialog-content').append(b);return b;}
 function openPrivacy() {show('PRIVACY UNVOR');paragraph('Questa Home usa risorse grafiche e caratteri salvati nell’app. Non invia elenco app, contatti, posizione, profili o statistiche a un server. La ricerca si apre nel browser su DuckDuckGo; l’app meteo scelta gestisce i propri dati.');paragraph('Il microfono si attiva al tocco. In Strumenti puoi anche attivare «Ehi UNVOR» mentre la Home è visibile. Il riconoscitore italiano Vosk e il suo modello sono inclusi nell’app; l’audio viene elaborato in memoria sul Pixel. Non usa il riconoscitore Google. L’agenda UNVOR salva appuntamenti e turni in un file privato cifrato AES-GCM con chiave Android Keystore. Non invia l’agenda al server. Gli avvisi e le sveglie agenda sono locali; una sveglia sonora termina dopo due minuti. Il calendario Android esterno si legge soltanto tramite il suo comando dedicato e dopo il permesso. Per chiamare un nome servono Rubrica e Telefono, richiesti al primo utilizzo. Nessuna copia della rubrica viene caricata su server. Il launcher non legge messaggi o chiavi di UNVOR Chat.');paragraph('Gli indicatori riportano spazio, RAM e batteria disponibili tramite Android. Non certificano l’integrità o la sicurezza di GrapheneOS. Le particelle del logo accompagnano ascolto e risposta vocale. Animazione sospesa fuori dalla Home o con riduzione movimento. Il modello AI non è ancora collegato. Le risposte vocali usano solo una voce italiana dichiarata offline da un motore installato diverso da Google; se manca, la risposta appare scritta.');menu('Informazioni e permessi di questa app',()=>{close();dispatch('appInfo');});}
 function openTools() {show('STRUMENTI');
 const wake=document.createElement('button');wake.className='menu-item';
 wake.textContent=state.wakeEnabled?'Disattiva «Ehi UNVOR»':'Attiva «Ehi UNVOR» sulla Home';
 wake.onclick=()=>{close();dispatch('wakeMode',{enabled:!state.wakeEnabled});};
 $('dialog-content').append(wake);
 menu('Telefono',()=>{close();dispatch('calls');});
 menu('Messaggi SMS',()=>{close();dispatch('sms');});menu('Cervelli AI personali',aiSettings);[['Agenda UNVOR e turni','planner'],['Sveglie','alarms'],['Timer','timer'],['Calendario Android autorizzato','calendar'],['Profilo UNVOR Chat','profile'],['Parla con UNVOR','voice'],['Voce italiana offline','voiceSetup'],['Leggi agenda UNVOR di oggi','agenda'],['Leggi calendario Android','externalAgenda']].forEach(([label,action])=>menu(label,()=>{close();dispatch(action);}));for(let n=1;n<=3;n++){menu('Collegamento personale '+n,()=>{close();dispatch('shortcut',{slot:'quick'+n});});menu('Scegli collegamento '+n,()=>openApps('quick'+n));}menu('Comando scritto a UNVOR',()=>{show('UNVOR · COMANDI');paragraph('Comandi locali: chiama mamma, metti la sveglia alle sei, agenda di oggi, apri agenda, i miei turni, apri seguito dal nome di un’app. Il modello AI conversazionale non è ancora integrato.');const input=document.createElement('input');input.type='text';input.maxLength=500;input.placeholder='Chiedi a UNVOR';input.setAttribute('aria-label','Comando scritto');$('dialog-content').append(input);const send=()=>{const text=input.value.trim();if(text){close();dispatch('command',{text});}};input.addEventListener('keydown',e=>{if(e.key==='Enter')send();});menu('Invia comando',send);input.focus();});menu('Interrompi ascolto e voce',()=>{close();dispatch('stopVoice');});const label=document.createElement('label');label.className='toggle';const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=!document.body.classList.contains('no-motion');checkbox.onchange=()=>{document.body.classList.toggle('no-motion',!checkbox.checked);dispatch('motion',{enabled:checkbox.checked});};label.append(checkbox,document.createTextNode('Effetti di transizione'));$('dialog-content').append(label);}

 function openUnvorSettings(){
  show('IMPOSTAZIONI UNVOR');
  paragraph('Preferenze del launcher. Le credenziali AI sono personali e non vengono condivise con altri utenti.');
  menu('Cervelli AI personali',aiSettings);
  menu('Strumenti e voce offline',openTools);
  menu('Privacy del launcher',openPrivacy);
  menu('Impostazioni Android',()=>{close();dispatch('settings');});
 }
 function aiSettings(){
  show('AI PERSONALI');
  paragraph('Caricamento delle impostazioni…');
  dispatch('aiList');
 }
 function renderAiSettings(){
  if(mode!=='AI PERSONALI')return;
  const content=$('dialog-content');content.replaceChildren();
  if(!personalAiState){paragraph('Caricamento delle impostazioni…');return;}
  paragraph('Ogni utente inserisce le proprie credenziali. Le chiavi sono cifrate con Android Keystore e rimangono su questo telefono.');
  paragraph((personalAiState.configured||0)+' configurati · '+(personalAiState.active||0)+' attivi. Usa priorità 1, 2 e 3 per il fallback automatico. Priorità 0 = riserva.');
  paragraph('I provider possono cambiare limiti, condizioni e prezzi. Seleziona solo modelli inclusi nel tuo piano. Il test invia una richiesta reale a ciascun provider configurato.');
  menu(aiPending?'TEST IN CORSO…':'⚡ Prova le AI ora',()=>{
   if(aiPending)return;aiPending=true;aiResults={};renderAiSettings();dispatch('aiTest');
  });
  for(const item of personalAiState.rows||[]){
   const label=String(item.name||item.id||'AI');
   const line=item.active?'Attivo · priorità '+item.priority:item.configured?'Configurato · riserva':'Non configurato';
   const status=element('div',null,'ai-provider',content);
   const button=element('button',label+' · '+line,'menu-item',status);
   button.type='button';
   button.onclick=()=>dispatch('aiEdit',{id:item.id});
   if(!item.available){button.disabled=true;button.textContent=label+' · API non più disponibile';}
   const details=element('small',null,'ai-provider-status',status);
   details.id='ai-test-'+item.id;details.textContent=aiResults[item.id]||'Non ancora testato';
   const info=element('small','Modello: '+String(item.model||'da impostare'),'ai-model',status);
   if(item.configured&&item.available){
    const remove=element('button','Rimuovi chiave e configurazione','menu-item',status);
    remove.onclick=()=>dispatch('aiDelete',{id:item.id});
   }
  }
  menu('Apri assistente UNVOR',openAssistant);
 }
 function openAssistant(){
  show('ASSISTENTE UNVOR');
  paragraph('Fai una domanda semplice. UNVOR usa il primo provider attivo; se non risponde passa al secondo e poi al terzo. Risposte normalmente brevi.');
  const box=$('dialog-content');
  const input=document.createElement('textarea');
  input.rows=3;input.maxLength=1000;
  input.placeholder='Scrivi la tua domanda…';
  input.setAttribute('aria-label','Domanda per UNVOR');
  input.className='menu-item';
  box.append(input);
  const answer=element('p','', 'ai-answer',box);answer.id='ai-result';answer.setAttribute('aria-live','polite');
  const send=()=>{const question=input.value.trim();if(!question)return;answer.textContent='Interrogo i cervelli AI…';dispatch('aiAsk',{question});};
  menu('Invia domanda',send);
  menu('Parla con UNVOR',()=>{close();dispatch('voice');});
  menu('Impostazioni cervelli AI',aiSettings);
  input.focus();
 }

 function openApps(slot=null) {selection=slot;show(slot?'SCEGLI APP':'APPLICAZIONI');selection=slot;paragraph('Caricamento delle app installate…');dispatch('apps');}
 function renderApps(rows) {apps=Array.isArray(rows)?rows:[];if(mode!=='SCEGLI APP'&&mode!=='APPLICAZIONI')return;const box=$('dialog-content');const before=box.querySelector('input[type="search"]');const previousQuery=before?.value||'';const hadFocus=document.activeElement===before;box.replaceChildren();const input=document.createElement('input');input.type='search';input.value=previousQuery;input.placeholder='Cerca applicazione';input.setAttribute('aria-label','Cerca applicazione');box.append(input);const list=document.createElement('div');box.append(list);function filter(){list.replaceChildren();const term=input.value.toLocaleLowerCase('it');apps.filter(a=>String(a.label).toLocaleLowerCase('it').includes(term)).forEach(app=>{const b=document.createElement('button');b.className='menu-item';if(app.icon){const image=document.createElement('img');image.src='data:image/png;base64,'+app.icon;image.alt='';b.append(image);}const text=document.createElement('span');text.className='app-row-text';text.textContent=app.label;b.append(text);b.onclick=()=>{const slot=selection;close();dispatch(slot?'choose':'launch',{slot,pkg:app.pkg,activity:app.activity});};list.append(b);});if(!list.childElementCount){const p=document.createElement('p');p.textContent='Nessuna applicazione trovata';list.append(p);}}input.oninput=filter;filter();if(hadFocus)input.focus();}
 function action(button) {const a=button.dataset.action;if(a==='apps')openApps();else if(a==='tools')openTools();else if(a==='privacy')openPrivacy();else if(a==='settings')openUnvorSettings();else if(a==='aiOpen')openAssistant();else dispatch(a,{slot:button.dataset.slot||null});}
 document.querySelectorAll('[data-action]').forEach(button=>{
  button.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();action(button);}});
  button.addEventListener('click',()=>{if(longTarget===button){longTarget=null;return;}longTarget=null;action(button);});
  if(button.dataset.slot){button.addEventListener('pointerdown',()=>{longTarget=null;timer=setTimeout(()=>{longTarget=button;openApps(button.dataset.slot);},650);});['pointerup','pointercancel','pointerleave'].forEach(type=>button.addEventListener(type,()=>clearTimeout(timer)));button.addEventListener('contextmenu',e=>e.preventDefault());}
 });
 $('answer-close').onclick=()=>{$('answer-box').hidden=true;};$('close').onclick=close;$('overlay').addEventListener('click',e=>{if(e.target===$('overlay'))close();});
 const hint=()=>{const node=$('search-hint');if(node)node.setAttribute('visibility',$('query').value?'hidden':'visible');};['input','focus','blur'].forEach(event=>$('query').addEventListener(event,hint));
 $('search').onsubmit=e=>{e.preventDefault();$('query').blur();dispatch('search',{query:$('query').value.slice(0,2048)});searchMode(false);};
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('overlay').hidden)close();});
 function meters(key,value) {const valid=Number.isFinite(value)&&value>=0&&value<=100;$(key+'-value').textContent=valid?Math.round(value)+'%':'N/D';const bar=$(key+'-bar');if(bar.namespaceURI==='http://www.w3.org/2000/svg')bar.setAttribute('width',String((valid?value:0)*1.92));else bar.style.width=(valid?value:0)+'%';}
 function update(s) {state=s||{};meters('ram',state.ram);meters('battery',state.battery);meters('disk',state.disk);$('device-name').textContent=state.device||'ANDROID';$('weather-app').textContent=state.weatherApp||'';$('alarm').textContent=state.alarm||'Nessuna sveglia visibile';document.body.classList.toggle('no-motion',state.motion===false);}
 let agendaRows=[],agendaStatus={},selectedDay=new Date(),month=new Date(new Date().getFullYear(),new Date().getMonth(),1),eventBusy=false;
 const dayKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
 function holiday(d){const md=dayKey(d).slice(5);if(['01-01','01-06','04-25','05-01','06-02','08-15','11-01','12-08','12-25','12-26'].includes(md))return true;const y=d.getFullYear(),a=y%19,b=Math.floor(y/100),c=y%100,e=Math.floor(b/4),f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-e-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*(b%4)+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),n=h+l-7*m+114;const easter=new Date(y,Math.floor(n/31)-1,n%31+1);easter.setDate(easter.getDate()+1);return dayKey(easter)===dayKey(d);}
 function element(tag,text,cls,parent=$('dialog-content')){const node=document.createElement(tag);if(text!=null)node.textContent=text;if(cls)node.className=cls;parent.append(node);return node;}
 function openPlanner(data){if(data){agendaRows=Array.isArray(data.rows)?data.rows:[];agendaStatus=data;}show('AGENDA UNVOR');const box=$('dialog-content');box.classList.add('planner-content');
  const nav=element('div',null,'month-nav');const prev=element('button','‹','month-arrow',nav);prev.setAttribute('aria-label','Mese precedente');element('strong',new Intl.DateTimeFormat('it-IT',{month:'long',year:'numeric'}).format(month),'',nav);const next=element('button','›','month-arrow',nav);next.setAttribute('aria-label','Mese successivo');prev.onclick=()=>{month=new Date(month.getFullYear(),month.getMonth()-1,1);selectedDay=new Date(month);openPlanner();};next.onclick=()=>{month=new Date(month.getFullYear(),month.getMonth()+1,1);selectedDay=new Date(month);openPlanner();};
  const grid=element('div',null,'month-grid');['L','M','M','G','V','S','D'].forEach((x,i)=>element('span',x,i===6?'holiday':'weekday',grid));const offset=(month.getDay()+6)%7;for(let n=0;n<offset;n++)element('span','','',grid);const days=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
  for(let n=1;n<=days;n++){const date=new Date(month.getFullYear(),month.getMonth(),n),key=dayKey(date),events=agendaRows.filter(r=>r.date===key);const b=element('button',String(n),(date.getDay()===0||holiday(date)?'holiday ':'')+(key===dayKey(selectedDay)?'selected-day ':'')+(events.length?'has-events':''),grid);b.setAttribute('aria-label',key+(date.getDay()===0||holiday(date)?' · festivo':'')+(events.length?' · '+events.length+' eventi':''));b.onclick=()=>{selectedDay=date;openPlanner();};}
  const prefix=dayKey(month).slice(0,7);const minutes=agendaRows.filter(r=>r.kind==='shift'&&r.date.startsWith(prefix)).reduce((sum,r)=>sum+Math.max(0,(r.endMs-r.startMs)/60000-r.pause),0);element('p',`ORE TURNI INIZIATI NEL MESE · ${Math.floor(minutes/60)} h ${Math.round(minutes%60)} min`,'hours-total');
  if(!agendaStatus.exact||!agendaStatus.notifications){paragraph('Avvisi non ancora pronti: servono notifiche e autorizzazione Sveglie e promemoria. Gli eventi restano salvati.');menu('Abilita gli avvisi sul Pixel',()=>dispatch('reminderPermissions'));}
  element('h2',new Intl.DateTimeFormat('it-IT',{weekday:'long',day:'numeric',month:'long'}).format(selectedDay),'day-title');
  const start=new Date(selectedDay.getFullYear(),selectedDay.getMonth(),selectedDay.getDate()).getTime(),end=new Date(selectedDay.getFullYear(),selectedDay.getMonth(),selectedDay.getDate()+1).getTime();const events=agendaRows.filter(r=>r.startMs<end&&r.endMs>start).sort((a,b)=>a.startMs-b.startMs);
  if(!events.length)paragraph('Nessun evento per questo giorno.');for(const row of events){const card=element('section',null,'agenda-card');element('strong',row.title,'',card);element('p',`${row.kind==='shift'?'TURNO':'APPUNTAMENTO'} · ${row.date} · ${row.start}–${row.end}${row.overnight?' (+1 giorno)':''}\n${row.zone}${row.kind==='shift'?' · pausa '+row.pause+' min':''}`,'',card);let status='Nessun avviso';if(row.reminder>=0){const at=row.startMs-row.reminder*60000;status=at<=Date.now()?'Avviso passato':agendaStatus.exact&&agendaStatus.notifications?(row.ring?'Sveglia locale':'Avviso locale')+' · '+row.reminder+' min prima':'Avviso in attesa dei permessi';}element('small',status,'',card);const edit=element('button','Modifica','menu-item',card);edit.onclick=()=>eventForm(row);const remove=element('button','Elimina evento','menu-item danger',card);remove.onclick=()=>{show('ELIMINA EVENTO');paragraph('Eliminare '+row.title+' e annullare il suo avviso locale?');menu('Elimina definitivamente',()=>dispatch('deleteEvent',{id:row.id}));menu('Annulla',()=>openPlanner());};}
  menu('＋ Appuntamento',()=>eventForm());menu('＋ Turno di lavoro',()=>eventForm({kind:'shift',title:'Turno',date:dayKey(selectedDay),start:'07:00',end:'14:00',pause:0,reminder:30}));menu('Ferma sveglia agenda in corso',()=>dispatch('stopAlarm'));menu('Sveglie del telefono',()=>{close();dispatch('alarms');});menu('Leggi gli impegni di oggi',()=>{close();dispatch('command',{text:'agenda di oggi'});});
 }
 function eventForm(row={}){show(row.id?'MODIFICA EVENTO':'NUOVO EVENTO');$('dialog-content').classList.add('planner-content');eventBusy=false;const form=element('form',null,'event-form');const field=(name,title,type,value)=>{const label=element('label',title,'field',form),input=element('input',null,'',label);input.type=type;input.name=name;input.value=value;input.required=true;return input;};const title=field('title','Titolo','text',row.title||'');title.maxLength=160;const typeLabel=element('label','Tipo','field',form),kind=element('select',null,'',typeLabel);for(const [value,text]of[['event','Appuntamento'],['shift','Turno di lavoro']]){const o=element('option',text,'',kind);o.value=value;}kind.value=row.kind||'event';const date=field('date','Giorno','date',row.date||dayKey(selectedDay)),start=field('start','Dalle','time',row.start||'09:00'),end=field('end','Alle','time',row.end||'10:00'),pause=field('pause','Pausa non lavorata (minuti, solo turni)','number',String(row.pause||0));pause.min='0';pause.max='1440';
  const check=(text,value)=>{const l=element('label',null,'toggle',form),c=element('input',null,'',l);c.type='checkbox';c.checked=!!value;l.append(document.createTextNode(text));return c;};const overnight=check('Fine il giorno successivo (turno notturno)',row.overnight);
  const remLabel=element('label','Preavviso locale','field',form),reminder=element('select',null,'',remLabel);for(const value of[-1,0,5,10,15,30,60,1440]){const o=element('option',value<0?'Nessun avviso':value===0?'All’inizio':value===1440?'Un giorno prima':value+' minuti prima','',reminder);o.value=String(value);}reminder.value=String(row.reminder??15);const ring=check('Suona come sveglia (si ferma dopo 2 minuti)',row.ring);element('p','Dati salvati solo sul Pixel. Gli avvisi dipendono dai permessi Android e dalle impostazioni del canale. Le ore usano la durata reale, inclusi i cambi dell’ora; per il totale mensile conta il giorno di inizio turno.','',form);
  const error=element('p','','form-error',form);error.id='event-error';const save=element('button','SALVA EVENTO','primary',form);save.type='submit';form.onsubmit=e=>{e.preventDefault();if(eventBusy)return;eventBusy=true;save.disabled=true;save.textContent='SALVATAGGIO…';error.textContent='';dispatch('saveEvent',{id:row.id||'',title:title.value,kind:kind.value,date:date.value,start:start.value,end:end.value,pause:kind.value==='shift'?Number(pause.value):0,overnight:overnight.checked,reminder:Number(reminder.value),ring:ring.checked});};menu('Annulla',()=>openPlanner());
 }

 window.UltronReceive=(type,data)=>{if(type==='voiceEngines'){show('VOCE ITALIANA OFFLINE');paragraph('La presenza di un motore non garantisce una voce italiana. Configura un modello italiano nel motore, poi torna qui e prova la lettura. Le release GrapheneOS controllate offrono solo inglese USA; non devi disinstallare il motore di sistema.');if(!data.length)paragraph('Nessun motore vocale senza Google rilevato.');for(const row of data)menu('Configura '+String(row.label),()=>{close();dispatch('voiceConfigure',{pkg:row.pkg});});menu('Preferenze vocali Android',()=>{close();dispatch('voiceSettings');});menu('Rileggi motori e prova italiano',()=>{close();dispatch('voiceTest');});}else if(type==='planner'){openPlanner(data);}else if(type==='newEvent'){eventForm({title:String(data).replace(/^(?:(?:unvor|ultron) )?(?:aggiungi|crea) appuntamento */i,'')});}else if(type==='eventError'){eventBusy=false;const err=$('event-error');if(err){err.textContent=String(data);const save=document.querySelector('.event-form .primary');save.disabled=false;save.textContent='SALVA EVENTO';}else toast(String(data));}else if(type==='eventSaved'){toast('Agenda aggiornata');}else if(type==='callChoices'){show('QUALE CONTATTO?');paragraph('Più numeri corrispondono al nome. Scegli chi chiamare.');for(const row of data)menu(String(row.label),()=>{close();dispatch('callChoice',{token:row.token});});}else if(type==='voiceBeat')window.UnvorGlobe?.beat();else if(type==='voice')window.UnvorGlobe?.setPhase(data);else if(type==='answer'){toast(String(data));$('answer-text').textContent=String(data);$('answer-box').hidden=false;}else if(type==='aiList'){personalAiState=data;if(mode==='AI PERSONALI')renderAiSettings();}else if(type==='aiTest'){aiResults[data.id]=data.status;if(mode==='AI PERSONALI'){const status=document.getElementById('ai-test-'+data.id);if(status)status.textContent=' · '+data.status;}}else if(type==='aiTestDone'){aiPending=false;if(mode==='AI PERSONALI')renderAiSettings();}else if(type==='aiAnswer'){const result=document.getElementById('ai-result');const text=typeof data==='string'?data:data?.text||'Risposta non disponibile';if(result)result.textContent=(data?.provider?data.provider+' · ':'')+text;else if(mode==='ASSISTENTE UNVOR')toast(text);}else if(type==='state'){update(data);window.UnvorGlobe?.setPhase(data.voicePhase||'idle');}else if(type==='apps')renderApps(data);else if(type==='pick')openApps(data);else if(type==='toast')toast(String(data));else if(type==='profile'){show('PROFILO UNVOR');paragraph(data.lns||'Nessun profilo condiviso da UNVOR Chat.');menu('Apri UNVOR Chat',()=>{close();dispatch('ultron');});}else if(type==='agenda'){show('AGENDA DI OGGI');paragraph(String(data));}};
 window.UltronBack=()=>{if(!$('overlay').hidden){close();return true;}return false;};
 function clock() {const now=new Date();const time=new Intl.DateTimeFormat('it-IT',{hour:'2-digit',minute:'2-digit'}).format(now);const date=new Intl.DateTimeFormat('it-IT',{weekday:'short',day:'numeric',month:'short',year:'numeric'}).format(now);if($('clock').textContent!==time)$('clock').textContent=time;if($('date').textContent!==date)$('date').textContent=date;}
 clock();setInterval(()=>{if(!document.hidden)clock();},1000);document.addEventListener('visibilitychange',()=>{if(!document.hidden){clock();dispatch('ready');}});
 if(native)dispatch('ready');else update({device:'ANDROID',ram:null,battery:null,disk:null,weatherApp:'',alarm:'Sveglie'});
})();
