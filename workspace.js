pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const $=id=>document.getElementById(id);
const state={mode:'merge',files:[],pageOrder:[],splitRanges:[],signatureDataUrl:null,signatureMode:'draw',placements:[],signPage:0,selectedPlacement:null,nextId:1,pageDrag:null};
const IMG_EXTS=['jpg','jpeg','png','webp','tiff','tif','bmp','gif'];

function firstPdf(){return state.files.find(f=>f.isPdf)||null}
function fileById(id){return state.files.find(f=>f.id===id)}
function fmtSize(b){if(b<1024)return b+' B';if(b<1048576)return(b/1024).toFixed(1)+' KB';return(b/1048576).toFixed(1)+' MB'}
function escapeHtml(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}

function setMode(mode){
  if(!['merge','split','sign'].includes(mode))mode='merge';
  state.mode=mode;
  document.querySelectorAll('[data-mode]').forEach(b=>{const on=b.dataset.mode===mode;b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on))});
  ['merge','split','sign'].forEach(m=>$(m+'-controls').classList.toggle('active',m===mode));
  $('merge-grid').style.display=mode==='merge'&&state.pageOrder.length?'grid':'none';
  $('split-area').classList.toggle('active',mode==='split'&&!!firstPdf());
  $('sign-area').classList.toggle('active',mode==='sign'&&!!firstPdf());
  $('empty-state').style.display=((mode==='merge'&&!state.pageOrder.length)||((mode==='split'||mode==='sign')&&!firstPdf()))?'grid':'none';

  const meta={
    merge:['Arrange & combine','Build one polished PDF','Add PDFs or images, drag pages into the right order, remove anything you do not need, then export one clean document.','Visual page workspace','Drag pages to reorder before export.','Merge & download','merged'],
    split:['Extract pages','Split one PDF your way','Choose page ranges to extract, or automatically create a separate PDF from every page.','Split PDF','Create page ranges or one file per page.','Split & download','split'],
    sign:['Add your signature','Sign a PDF visually','Draw or type a signature, place it exactly where it belongs, resize it, and export the signed PDF in your browser.','Sign PDF','Place and position a visual electronic signature.','Download signed PDF','signed']
  }[mode];
  $('mode-eyebrow').textContent=meta[0];$('mode-title').textContent=meta[1];$('mode-copy').textContent=meta[2];
  $('canvas-title').textContent=meta[3];$('canvas-copy').textContent=meta[4];$('export-btn').textContent=meta[5];
  const out=$('output-name');if(['merged','split','signed'].includes(out.value))out.value=meta[6];
  updateEmptyCopy();updateStats();updateExportState();
  if(mode==='split')renderSplit();
  if(mode==='sign'&&firstPdf())renderSignPage();
  const url=new URL(location.href);url.searchParams.set('mode',mode);history.replaceState(null,'',url);
}

function updateEmptyCopy(){
  const icon=$('empty-icon'),title=$('empty-title'),copy=$('empty-copy'),steps=$('empty-steps');
  if(state.mode==='merge'){
    icon.textContent='🗂️';title.textContent='Start with your files';copy.textContent='Drop PDFs or images into the workspace. You will see every page before anything is exported.';
    steps.innerHTML='<div class="empty-step"><strong>1. Add files</strong>PDFs and common image formats.</div><div class="empty-step"><strong>2. Arrange</strong>Drag pages and remove extras.</div><div class="empty-step"><strong>3. Export</strong>Create one organized PDF.</div>';
  }else if(state.mode==='split'){
    icon.textContent='✂️';title.textContent='Add a PDF to split';copy.textContent='Choose a PDF and define exactly which pages should become separate files.';
    steps.innerHTML='<div class="empty-step"><strong>1. Add PDF</strong>Select the document to split.</div><div class="empty-step"><strong>2. Choose ranges</strong>Try 1-3, 5, or 2-4,7.</div><div class="empty-step"><strong>3. Download</strong>Export each requested part.</div>';
  }else{
    icon.textContent='✍️';title.textContent='Add a PDF to sign';copy.textContent='Your local PDF stays in the browser while you create and place a visual signature.';
    steps.innerHTML='<div class="empty-step"><strong>1. Add PDF</strong>Open the document you need.</div><div class="empty-step"><strong>2. Create signature</strong>Draw it or type your name.</div><div class="empty-step"><strong>3. Place & export</strong>Position it and download.</div>';
  }
}

async function addFiles(list){
  const accepted=list.filter(f=>f.type==='application/pdf'||f.name.toLowerCase().endsWith('.pdf')||f.type.startsWith('image/')||IMG_EXTS.includes((f.name.split('.').pop()||'').toLowerCase()));
  if(!accepted.length)return toast('Choose a PDF or supported image file','error');
  progress('Loading files…',12);
  try{
    for(const file of accepted){
      if(state.files.some(x=>x.name===file.name&&x.size===file.size))continue;
      const isPdf=file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf');
      const entry={id:state.nextId++,file,name:file.name,size:file.size,isPdf,pages:1,pdfDoc:null,bytes:null,imgUrl:null};
      if(isPdf){
        const buf=await file.arrayBuffer();entry.bytes=new Uint8Array(buf.slice(0));entry.pdfDoc=await pdfjsLib.getDocument({data:new Uint8Array(buf)}).promise;entry.pages=entry.pdfDoc.numPages;
      }else{entry.imgUrl=URL.createObjectURL(file)}
      state.files.push(entry);
      for(let p=1;p<=entry.pages;p++)state.pageOrder.push({fileId:entry.id,pageNum:p});
    }
    state.signPage=0;renderAll();toast('Files ready','success');
  }catch(e){console.error(e);toast('One of the files could not be loaded','error')}finally{hideProgress()}
}

function removeFile(id){
  const f=fileById(id);if(f?.imgUrl)URL.revokeObjectURL(f.imgUrl);
  state.files=state.files.filter(f=>f.id!==id);state.pageOrder=state.pageOrder.filter(p=>p.fileId!==id);
  if(!firstPdf()){state.splitRanges=[];state.placements=[];state.signPage=0}
  renderAll();
}
function clearFiles(){state.files.forEach(f=>{if(f.imgUrl)URL.revokeObjectURL(f.imgUrl)});state.files=[];state.pageOrder=[];state.splitRanges=[];state.placements=[];state.signPage=0;renderAll();toast('Workspace cleared','success')}

function renderAll(){renderFileList();renderMergeGrid();renderSplit();if(state.mode==='sign'&&firstPdf())renderSignPage();setMode(state.mode)}
function renderFileList(){
  const el=$('file-list');
  if(!state.files.length){el.innerHTML='<div class="empty-files">No files added yet.</div>';return}
  el.innerHTML=state.files.map(f=>`<div class="file-row"><span class="file-badge">${f.isPdf?'PDF':'IMG'}</span><div class="file-main"><strong title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</strong><span>${f.pages} page${f.pages!==1?'s':''} · ${fmtSize(f.size)}</span></div><button class="remove-file" type="button" aria-label="Remove ${escapeHtml(f.name)}" onclick="removeFile(${f.id})">✕</button></div>`).join('');
}

function renderMergeGrid(){
  const grid=$('merge-grid');grid.innerHTML='';
  state.pageOrder.forEach((item,index)=>{
    const f=fileById(item.fileId);if(!f)return;
    const card=document.createElement('div');card.className='page-card';card.draggable=true;card.dataset.index=index;
    card.innerHTML=`<div class="page-paper"><div class="page-num">${index+1}</div><button class="page-remove" type="button" aria-label="Remove page ${index+1}">✕</button></div><div class="page-meta"><span title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span><span>${f.isPdf?'p'+item.pageNum:'image'}</span></div>`;
    card.querySelector('.page-remove').onclick=e=>{e.stopPropagation();state.pageOrder.splice(index,1);renderAll()};
    card.addEventListener('dragstart',()=>{state.pageDrag=index;setTimeout(()=>card.classList.add('dragging'),0)});
    card.addEventListener('dragend',()=>{state.pageDrag=null;document.querySelectorAll('.page-card').forEach(x=>x.classList.remove('dragging','drag-over'))});
    card.addEventListener('dragover',e=>{e.preventDefault();if(state.pageDrag!==index)card.classList.add('drag-over')});
    card.addEventListener('dragleave',()=>card.classList.remove('drag-over'));
    card.addEventListener('drop',e=>{e.preventDefault();if(state.pageDrag===null||state.pageDrag===index)return;const moved=state.pageOrder.splice(state.pageDrag,1)[0];state.pageOrder.splice(index,0,moved);renderMergeGrid();updateStats()});
    grid.appendChild(card);renderThumb(item,card.querySelector('.page-paper'));
  });
}
async function renderThumb(item,wrap){
  const f=fileById(item.fileId);if(!f)return;
  try{
    if(f.isPdf){const page=await f.pdfDoc.getPage(item.pageNum);const base=page.getViewport({scale:1});const vp=page.getViewport({scale:280/base.width});const cv=document.createElement('canvas');cv.width=Math.round(vp.width);cv.height=Math.round(vp.height);await page.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;wrap.insertBefore(cv,wrap.firstChild)}
    else{const img=document.createElement('img');img.src=f.imgUrl;img.alt='';wrap.insertBefore(img,wrap.firstChild)}
  }catch(e){console.warn('thumbnail',e)}
}

function renderSplit(){
  const pdf=firstPdf();$('split-area').classList.toggle('active',state.mode==='split'&&!!pdf);
  if(!pdf)return;
  $('split-summary').textContent=`${pdf.name} · ${pdf.pages} pages`;
  const list=$('range-list');
  if(!state.splitRanges.length)list.innerHTML='<div class="empty-files">No ranges added yet.</div>';
  else list.innerHTML=state.splitRanges.map((r,i)=>`<div class="range-chip"><strong>Part ${i+1}</strong><span>Pages ${escapeHtml(r)}</span><button class="remove-file" type="button" onclick="removeRange(${i})">✕</button></div>`).join('');
}
function addRange(){const v=$('split-input').value.trim();if(!v)return toast('Enter a page range','error');state.splitRanges.push(v);$('split-input').value='';renderSplit();updateExportState()}
function removeRange(i){state.splitRanges.splice(i,1);renderSplit();updateExportState()}
function autoSplit(){const pdf=firstPdf();if(!pdf)return toast('Add a PDF first','error');state.splitRanges=Array.from({length:pdf.pages},(_,i)=>String(i+1));renderSplit();updateExportState()}
function parseRange(str,total){const out=new Set();str.split(',').forEach(part=>{part=part.trim();const m=part.match(/^(\d+)\s*-\s*(\d+)$/);if(m){let a=+m[1],b=+m[2];if(a>b)[a,b]=[b,a];for(let n=a;n<=Math.min(b,total);n++)if(n>=1)out.add(n)}else if(/^\d+$/.test(part)){const n=+part;if(n>=1&&n<=total)out.add(n)}});return[...out].sort((a,b)=>a-b)}

function initSignaturePad(){
  const c=$('sig-pad'),ctx=c.getContext('2d');let drawing=false,drawn=false;
  const resize=()=>{const r=c.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);const old=drawn?c.toDataURL():null;c.width=Math.max(1,Math.round(r.width*dpr));c.height=Math.max(1,Math.round(r.height*dpr));ctx.setTransform(dpr,0,0,dpr,0,0);ctx.lineWidth=2.4;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#111';if(old){const im=new Image();im.onload=()=>ctx.drawImage(im,0,0,r.width,r.height);im.src=old}};
  resize();window.addEventListener('resize',()=>setTimeout(resize,80));
  const pt=e=>{const r=c.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}};
  c.addEventListener('pointerdown',e=>{drawing=true;drawn=true;c.setPointerCapture(e.pointerId);const p=pt(e);ctx.beginPath();ctx.moveTo(p.x,p.y)});
  c.addEventListener('pointermove',e=>{if(!drawing)return;const p=pt(e);ctx.lineTo(p.x,p.y);ctx.stroke()});
  c.addEventListener('pointerup',()=>drawing=false);c.addEventListener('pointercancel',()=>drawing=false);
  $('clear-sig').onclick=()=>{ctx.clearRect(0,0,c.width,c.height);drawn=false};
  window.getDrawSignature=()=>drawn?c.toDataURL('image/png'):null;
}
function setSignatureMode(m){state.signatureMode=m;document.querySelectorAll('.sig-tab').forEach(x=>x.classList.toggle('active',x.dataset.sig===m));$('draw-wrap').classList.toggle('hidden',m!=='draw');$('typed-wrap').classList.toggle('active',m==='type')}
function makeTypedSignature(text){
  const c=document.createElement('canvas');c.width=900;c.height=220;const x=c.getContext('2d');x.clearRect(0,0,c.width,c.height);x.fillStyle='#111';x.font='108px "Brush Script MT","Segoe Script",cursive';x.textBaseline='middle';x.fillText(text,24,112);return c.toDataURL('image/png')
}
function useSignature(){
  let data=null;if(state.signatureMode==='draw')data=window.getDrawSignature?.();else{const t=$('sig-type-input').value.trim();if(t)data=makeTypedSignature(t)}
  if(!data)return toast(state.signatureMode==='draw'?'Draw a signature first':'Type your name first','error');
  state.signatureDataUrl=data;$('sig-preview').innerHTML=`<img src="${data}" alt="Current signature">`;toast('Signature ready — click the document to place it','success');updateExportState();
}

async function renderSignPage(){
  const pdf=firstPdf();if(!pdf||state.mode!=='sign')return;
  state.signPage=Math.max(0,Math.min(state.signPage,pdf.pages-1));$('sign-page-label').textContent=`Page ${state.signPage+1} / ${pdf.pages}`;$('sign-prev').disabled=state.signPage===0;$('sign-next').disabled=state.signPage===pdf.pages-1;
  const page=await pdf.pdfDoc.getPage(state.signPage+1),base=page.getViewport({scale:1});const maxW=Math.min(820,Math.max(320,$('sign-stage-wrap').clientWidth-34));const vp=page.getViewport({scale:maxW/base.width});const cv=$('sign-canvas');cv.width=Math.round(vp.width);cv.height=Math.round(vp.height);cv.style.width=cv.width+'px';cv.style.height=cv.height+'px';await page.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;
  const stage=$('sign-stage');stage.style.width=cv.width+'px';stage.style.height=cv.height+'px';renderPlacements();updateStats();
}
function changeSignPage(delta){state.signPage+=delta;state.selectedPlacement=null;renderSignPage()}
function placeSignature(e){
  if(e.target.closest('.sig-placement'))return;if(!state.signatureDataUrl)return toast('Create a signature first','error');
  const stage=$('sign-stage'),r=stage.getBoundingClientRect();let w=(+$('sig-size').value||26)/100;let x=(e.clientX-r.left)/r.width-w/2;let y=(e.clientY-r.top)/r.height-.04;x=Math.max(0,Math.min(.98-w,x));y=Math.max(0,Math.min(.92,y));
  const p={id:state.nextId++,pageIndex:state.signPage,x,y,w,dataUrl:state.signatureDataUrl};state.placements.push(p);state.selectedPlacement=p.id;renderPlacements();updateExportState();
}
function renderPlacements(){
  const stage=$('sign-stage');stage.querySelectorAll('.sig-placement').forEach(n=>n.remove());
  state.placements.filter(p=>p.pageIndex===state.signPage).forEach(p=>{
    const el=document.createElement('div');el.className='sig-placement'+(p.id===state.selectedPlacement?' selected':'');el.dataset.id=p.id;el.style.left=(p.x*100)+'%';el.style.top=(p.y*100)+'%';el.style.width=(p.w*100)+'%';el.innerHTML=`<img src="${p.dataUrl}" alt="Signature placement"><button class="sig-remove" type="button">✕</button>`;
    el.onclick=ev=>{ev.stopPropagation();state.selectedPlacement=p.id;$('sig-size').value=Math.round(p.w*100);renderPlacements()};
    el.querySelector('.sig-remove').onclick=ev=>{ev.stopPropagation();state.placements=state.placements.filter(x=>x.id!==p.id);if(state.selectedPlacement===p.id)state.selectedPlacement=null;renderPlacements();updateExportState()};
    el.addEventListener('pointerdown',ev=>startPlacementDrag(ev,p));stage.appendChild(el);
  });
}
function startPlacementDrag(e,p){
  if(e.target.closest('.sig-remove'))return;e.preventDefault();state.selectedPlacement=p.id;const stage=$('sign-stage'),r=stage.getBoundingClientRect(),sx=e.clientX,sy=e.clientY,ox=p.x,oy=p.y;
  const move=ev=>{p.x=Math.max(0,Math.min(.98-p.w,ox+(ev.clientX-sx)/r.width));p.y=Math.max(0,Math.min(.94,oy+(ev.clientY-sy)/r.height));const el=stage.querySelector(`[data-id="${p.id}"]`);if(el){el.style.left=p.x*100+'%';el.style.top=p.y*100+'%'}};
  const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);renderPlacements()};window.addEventListener('pointermove',move);window.addEventListener('pointerup',up)
}
function resizeSelected(){const p=state.placements.find(x=>x.id===state.selectedPlacement);if(p){p.w=(+$('sig-size').value)/100;p.x=Math.min(p.x,.98-p.w);renderPlacements()}}
function undoPlacement(){state.placements.pop();state.selectedPlacement=null;renderPlacements();updateExportState()}
function clearPlacements(){state.placements=[];state.selectedPlacement=null;renderPlacements();updateExportState()}

async function exportCurrent(){if(state.mode==='merge')return runMerge();if(state.mode==='split')return runSplit();return runSign()}
async function runMerge(){
  if(!state.pageOrder.length)return toast('Add at least one file','error');progress('Building your PDF…',8);
  try{const out=await PDFLib.PDFDocument.create(),cache=new Map();for(let i=0;i<state.pageOrder.length;i++){const item=state.pageOrder[i],f=fileById(item.fileId);if(f.isPdf){let src=cache.get(f.id);if(!src){src=await PDFLib.PDFDocument.load(f.bytes);cache.set(f.id,src)}const[pg]=await out.copyPages(src,[item.pageNum-1]);out.addPage(pg)}else{const img=await embedFileImage(out,f);if(img){const d=img.scale(1),page=out.addPage([d.width,d.height]);page.drawImage(img,{x:0,y:0,width:d.width,height:d.height})}}setProgress(8+82*(i+1)/state.pageOrder.length)}const bytes=await out.save();download(bytes,filename('merged'));toast(`${out.getPageCount()} pages merged`,'success')}catch(e){console.error(e);toast('Could not merge these files','error')}finally{hideProgress()}
}
async function embedFileImage(doc,f){const ext=(f.name.split('.').pop()||'').toLowerCase(),buf=await f.file.arrayBuffer();if(ext==='jpg'||ext==='jpeg')return doc.embedJpg(buf);if(ext==='png')return doc.embedPng(buf);return new Promise(resolve=>{const im=new Image();im.onload=()=>{const c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;c.getContext('2d').drawImage(im,0,0);c.toBlob(async b=>resolve(b?await doc.embedPng(await b.arrayBuffer()):null),'image/png')};im.onerror=()=>resolve(null);im.src=f.imgUrl})}
async function runSplit(){
  const pdf=firstPdf();if(!pdf)return toast('Add a PDF first','error');if(!state.splitRanges.length)return toast('Add at least one page range','error');progress('Splitting PDF…',8);
  try{const src=await PDFLib.PDFDocument.load(pdf.bytes),total=src.getPageCount();for(let i=0;i<state.splitRanges.length;i++){const nums=parseRange(state.splitRanges[i],total);if(!nums.length)continue;const out=await PDFLib.PDFDocument.create(),pages=await out.copyPages(src,nums.map(n=>n-1));pages.forEach(p=>out.addPage(p));download(await out.save(),`${baseName()}-part-${i+1}.pdf`);setProgress(8+82*(i+1)/state.splitRanges.length);await new Promise(r=>setTimeout(r,220))}toast('Split files created','success')}catch(e){console.error(e);toast('Could not split this PDF','error')}finally{hideProgress()}
}
async function runSign(){
  const pdf=firstPdf();if(!pdf)return toast('Add a PDF first','error');if(!state.placements.length)return toast('Place at least one signature','error');progress('Applying signatures…',12);
  try{const doc=await PDFLib.PDFDocument.load(pdf.bytes),cache=new Map();for(let i=0;i<state.placements.length;i++){const p=state.placements[i];let img=cache.get(p.dataUrl);if(!img){img=await doc.embedPng(await dataUrlBytes(p.dataUrl));cache.set(p.dataUrl,img)}const page=doc.getPage(p.pageIndex),pw=page.getWidth(),ph=page.getHeight(),w=p.w*pw,h=w*(img.height/img.width),x=p.x*pw,y=ph-p.y*ph-h;page.drawImage(img,{x,y,width:w,height:h});setProgress(12+78*(i+1)/state.placements.length)}download(await doc.save(),filename('signed'));toast('Signed PDF downloaded','success')}catch(e){console.error(e);toast('Could not create the signed PDF','error')}finally{hideProgress()}
}
function dataUrlBytes(url){return fetch(url).then(r=>r.arrayBuffer()).then(b=>new Uint8Array(b))}
function baseName(){return($('output-name').value.trim()||state.mode||'document').replace(/\.pdf$/i,'')}
function filename(fallback){return(($('output-name').value.trim()||fallback).replace(/\.pdf$/i,''))+'.pdf'}
function download(bytes,name){const u=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'})),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),6000)}

async function fetchRemote(url,name){if(!url)return toast('Enter a URL','error');progress('Fetching file…',18);try{const r=await fetch(`/api/proxy?url=${encodeURIComponent(url)}`);if(!r.ok)throw new Error(String(r.status));const b=await r.blob(),n=name||url.split('/').pop().split('?')[0]||'imported.pdf';await addFiles([new File([b],n,{type:b.type||'application/pdf'})])}catch(e){console.error(e);toast('Could not fetch that file','error')}finally{hideProgress()}}
function importUrl(){const v=$('url-input').value.trim();$('url-input').value='';fetchRemote(v)}
function importDrive(){const v=$('drive-input').value.trim();const m=v.match(/\/d\/([a-zA-Z0-9_-]+)/)||v.match(/[?&]id=([a-zA-Z0-9_-]+)/);if(!m)return toast('Paste a valid shareable Drive link','error');$('drive-input').value='';fetchRemote(`https://drive.google.com/uc?export=download&id=${m[1]}`,`drive-${m[1]}.pdf`)}

function updateStats(){const pdf=firstPdf();if(state.mode==='merge')$('canvas-stats').textContent=`${state.pageOrder.length} page${state.pageOrder.length!==1?'s':''} · ${state.files.length} file${state.files.length!==1?'s':''}`;else if(state.mode==='split')$('canvas-stats').textContent=pdf?`${pdf.pages} pages · ${state.splitRanges.length} range${state.splitRanges.length!==1?'s':''}`:'No PDF';else $('canvas-stats').textContent=pdf?`${pdf.pages} pages · ${state.placements.length} signature${state.placements.length!==1?'s':''}`:'No PDF'}
function updateExportState(){let ok=false;if(state.mode==='merge')ok=state.pageOrder.length>0;if(state.mode==='split')ok=!!firstPdf()&&state.splitRanges.length>0;if(state.mode==='sign')ok=!!firstPdf()&&state.placements.length>0;$('export-btn').disabled=!ok;updateStats()}
function progress(label,pct){$('progress').classList.add('show');$('progress-label').textContent=label;setProgress(pct)}function setProgress(p){$('progress-fill').style.width=Math.max(4,Math.min(100,p))+'%'}function hideProgress(){setProgress(100);setTimeout(()=>$('progress').classList.remove('show'),250)}
let toastTimer;function toast(msg,type=''){const t=$('toast');t.textContent=msg;t.className='toast show '+type;clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.className='toast',3000)}
function toggleTheme(){const root=document.documentElement;root.dataset.theme=root.dataset.theme==='light'?'dark':'light';localStorage.setItem('fold-theme',root.dataset.theme)}

function bind(){
  document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
  const dz=$('dropzone'),fi=$('file-input');dz.onclick=()=>fi.click();dz.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();fi.click()}};fi.onchange=e=>{addFiles([...e.target.files]);fi.value=''};
  dz.ondragover=e=>{e.preventDefault();dz.classList.add('over')};dz.ondragleave=()=>dz.classList.remove('over');dz.ondrop=e=>{e.preventDefault();dz.classList.remove('over');addFiles([...e.dataTransfer.files])};
  $('clear-files').onclick=clearFiles;$('add-range').onclick=addRange;$('auto-split').onclick=autoSplit;$('split-input').onkeydown=e=>{if(e.key==='Enter')addRange()};$('export-btn').onclick=exportCurrent;
  $('sig-draw-tab').onclick=()=>setSignatureMode('draw');$('sig-type-tab').onclick=()=>setSignatureMode('type');$('use-signature').onclick=useSignature;$('sig-size').oninput=resizeSelected;
  $('sign-prev').onclick=()=>changeSignPage(-1);$('sign-next').onclick=()=>changeSignPage(1);$('sign-stage').onclick=placeSignature;$('undo-placement').onclick=undoPlacement;$('clear-placements').onclick=clearPlacements;
  $('fetch-url').onclick=importUrl;$('import-drive').onclick=importDrive;$('theme-btn').onclick=toggleTheme;
}

document.addEventListener('DOMContentLoaded',()=>{const saved=localStorage.getItem('fold-theme');if(saved)document.documentElement.dataset.theme=saved;bind();initSignaturePad();const mode=new URLSearchParams(location.search).get('mode');setMode(['merge','split','sign'].includes(mode)?mode:'merge');renderAll()});