pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const $=id=>document.getElementById(id);
const state={mode:'merge',files:[],pageOrder:[],splitRanges:[],signatureDataUrl:null,signatureAspect:.25,signatureMode:'draw',placements:[],signPage:0,selectedPlacement:null,nextId:1,pageDrag:null,signRenderTask:null,signRenderToken:0,busy:false};
const IMG_EXTS=['jpg','jpeg','png','webp'];
const IMG_TYPES=['image/jpeg','image/png','image/webp'];
let mergeRenderToken=0,thumbObserver=null;

function firstPdf(){return state.files.find(f=>f.isPdf)||null}
function fileById(id){return state.files.find(f=>f.id===id)}
function fmtSize(b){if(b<1024)return b+' B';if(b<1048576)return(b/1024).toFixed(1)+' KB';return(b/1048576).toFixed(1)+' MB'}
function escapeHtml(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function isPdfFile(file){return file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf')}
function isImageFile(file){const ext=(file.name.split('.').pop()||'').toLowerCase();return IMG_TYPES.includes(file.type)||IMG_EXTS.includes(ext)}
function destroyPdf(entry){if(entry?.pdfDoc){try{const result=entry.pdfDoc.destroy();if(result?.catch)result.catch(()=>{})}catch(e){console.warn('pdf cleanup',e)}entry.pdfDoc=null}entry.bytes=null}
function loadImage(url){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('Unsupported or malformed image'));img.src=url})}
function pageLabel(item,index){const file=fileById(item.fileId);return `Output page ${index+1}: ${file?.name||'file'}${file?.isPdf?`, source page ${item.pageNum}`:', image'}`}

function setMode(mode){
  if(!['merge','split','sign'].includes(mode))mode='merge';
  if(mode!=='sign'){
    state.signRenderToken++;
    try{state.signRenderTask?.cancel()}catch(e){}
    state.signRenderTask=null;
  }
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

async function addFiles(list,origin='local'){
  const accepted=list.filter(f=>isPdfFile(f)||isImageFile(f));
  const rejected=list.filter(f=>!accepted.includes(f)).map(f=>f.name);
  if(!accepted.length)return toast('Choose a PDF, JPG, PNG, or WebP file','error');
  progress('Loading files…',12);
  let added=0;
  for(const file of accepted){
    let imgUrl=null;
    try{
      const isPdf=isPdfFile(file);
      const entry={id:state.nextId++,file,name:file.name,size:file.size,isPdf,pages:1,pdfDoc:null,bytes:null,imgUrl:null,origin};
      if(isPdf){
        const buf=await file.arrayBuffer();
        entry.bytes=new Uint8Array(buf.slice(0));
        entry.pdfDoc=await pdfjsLib.getDocument({data:new Uint8Array(buf),isEvalSupported:false}).promise;
        entry.pages=entry.pdfDoc.numPages;
      }else{
        imgUrl=URL.createObjectURL(file);
        await loadImage(imgUrl);
        entry.imgUrl=imgUrl;
      }
      state.files.push(entry);
      for(let p=1;p<=entry.pages;p++)state.pageOrder.push({fileId:entry.id,pageNum:p,rotation:0});
      added++;
    }catch(e){
      if(imgUrl)URL.revokeObjectURL(imgUrl);
      rejected.push(file.name);
      console.warn('file load failed',file.name,e);
    }
  }
  if(added){state.signPage=0;renderAll()}
  hideProgress();
  if(rejected.length)toast(`${added?`${added} added · `:''}${rejected.length} could not be read: ${rejected.slice(0,2).join(', ')}${rejected.length>2?'…':''}`,'error');
  else toast(`${added} file${added!==1?'s':''} ready`,'success');
}

function removeFile(id){
  const activeId=firstPdf()?.id;
  const f=fileById(id);if(f?.imgUrl)URL.revokeObjectURL(f.imgUrl);destroyPdf(f);
  state.files=state.files.filter(f=>f.id!==id);state.pageOrder=state.pageOrder.filter(p=>p.fileId!==id);
  if(activeId!==firstPdf()?.id){state.splitRanges=[];state.placements=[];state.signPage=0;state.selectedPlacement=null}
  renderAll();
}
function clearFiles(){
  state.files.forEach(f=>{if(f.imgUrl)URL.revokeObjectURL(f.imgUrl);destroyPdf(f)});
  state.files=[];state.pageOrder=[];state.splitRanges=[];state.placements=[];state.signPage=0;state.selectedPlacement=null;state.signatureDataUrl=null;
  $('sig-type-input').value='';$('sig-preview').innerHTML='<span>Your signature preview</span>';$('clear-sig').click();
  renderAll();toast('Files and signature cleared','success');
}

function renderAll(){renderFileList();renderMergeGrid();renderSplit();if(state.mode==='sign'&&firstPdf())renderSignPage();setMode(state.mode)}
function renderFileList(){
  const el=$('file-list');
  $('clear-files').disabled=!state.files.length;
  if(!state.files.length){el.innerHTML='<div class="empty-files">No files added yet.</div>';return}
  el.innerHTML=state.files.map(f=>`<div class="file-row"><span class="file-badge">${f.isPdf?'PDF':'IMG'}</span><div class="file-main"><strong title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</strong><span>${f.pages} page${f.pages!==1?'s':''} · ${fmtSize(f.size)} · ${f.origin==='remote'?'server fetched':'local'}</span></div><button class="remove-file" type="button" aria-label="Remove ${escapeHtml(f.name)}" onclick="removeFile(${f.id})">✕</button></div>`).join('');
}

function renderMergeGrid(){
  const grid=$('merge-grid'),token=++mergeRenderToken;grid.innerHTML='';
  thumbObserver?.disconnect();
  thumbObserver='IntersectionObserver' in window?new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){const wrap=entry.target;thumbObserver.unobserve(wrap);renderThumb(wrap._pageItem,wrap,token)}}),{rootMargin:'700px'}):null;
  state.pageOrder.forEach((item,index)=>{
    const f=fileById(item.fileId);if(!f)return;
    const card=document.createElement('div');card.className='page-card';card.draggable=true;card.dataset.index=index;card.setAttribute('role','listitem');card.setAttribute('aria-label',pageLabel(item,index));
    card.innerHTML=`<div class="page-paper"><div class="page-thumb-status">Rendering preview…</div><div class="page-num">${index+1}</div><button class="page-remove" type="button" aria-label="Remove output page ${index+1}">✕</button></div><div class="page-meta"><span title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span><span>${f.isPdf?'p'+item.pageNum:'image'} · ${item.rotation||0}°</span></div><div class="page-actions"><button type="button" data-action="earlier" aria-label="Move output page ${index+1} earlier" ${index===0?'disabled':''}>←</button><button type="button" data-action="later" aria-label="Move output page ${index+1} later" ${index===state.pageOrder.length-1?'disabled':''}>→</button><button type="button" data-action="rotate" aria-label="Rotate output page ${index+1} clockwise">↻</button></div>`;
    card.querySelector('.page-remove').onclick=e=>{e.stopPropagation();state.pageOrder.splice(index,1);renderAll()};
    card.querySelector('[data-action="earlier"]').onclick=e=>{e.stopPropagation();movePage(index,-1)};
    card.querySelector('[data-action="later"]').onclick=e=>{e.stopPropagation();movePage(index,1)};
    card.querySelector('[data-action="rotate"]').onclick=e=>{e.stopPropagation();rotatePage(index)};
    card.addEventListener('dragstart',()=>{state.pageDrag=index;setTimeout(()=>card.classList.add('dragging'),0)});
    card.addEventListener('dragend',()=>{state.pageDrag=null;document.querySelectorAll('.page-card').forEach(x=>x.classList.remove('dragging','drag-over'))});
    card.addEventListener('dragover',e=>{e.preventDefault();if(state.pageDrag!==index)card.classList.add('drag-over')});
    card.addEventListener('dragleave',()=>card.classList.remove('drag-over'));
    card.addEventListener('drop',e=>{e.preventDefault();if(state.pageDrag===null||state.pageDrag===index)return;const from=state.pageDrag,target=from<index?index-1:index,moved=state.pageOrder.splice(from,1)[0];state.pageOrder.splice(target,0,moved);renderMergeGrid();updateStats();toast(`Page moved to position ${target+1}`,'success')});
    grid.appendChild(card);
    const wrap=card.querySelector('.page-paper');wrap._pageItem=item;if(thumbObserver)thumbObserver.observe(wrap);else renderThumb(item,wrap,token);
  });
}
function movePage(index,delta){const target=Math.max(0,Math.min(state.pageOrder.length-1,index+delta));if(target===index)return;const[moved]=state.pageOrder.splice(index,1);state.pageOrder.splice(target,0,moved);renderMergeGrid();updateStats();toast(`Page moved to position ${target+1}`,'success');setTimeout(()=>$('merge-grid').querySelector(`[data-index="${target}"] [data-action="${delta<0?'earlier':'later'}"]`)?.focus(),0)}
function rotatePage(index){const item=state.pageOrder[index];if(!item)return;item.rotation=((item.rotation||0)+90)%360;renderMergeGrid();toast(`Page ${index+1} rotated to ${item.rotation}°`,'success')}
async function renderThumb(item,wrap,token=mergeRenderToken){
  const f=fileById(item.fileId);if(!f)return;
  try{
    if(f.isPdf){const page=await f.pdfDoc.getPage(item.pageNum);const base=page.getViewport({scale:1,rotation:(page.rotate+(item.rotation||0))%360});const vp=page.getViewport({scale:280/base.width,rotation:(page.rotate+(item.rotation||0))%360});const cv=document.createElement('canvas');cv.width=Math.round(vp.width);cv.height=Math.round(vp.height);await page.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;if(token!==mergeRenderToken||!wrap.isConnected)return;wrap.querySelector('.page-thumb-status')?.remove();wrap.insertBefore(cv,wrap.firstChild)}
    else{const img=document.createElement('img');img.src=f.imgUrl;img.alt='';img.style.transform=`rotate(${item.rotation||0}deg)`;await img.decode?.().catch(()=>{});if(token!==mergeRenderToken||!wrap.isConnected)return;wrap.querySelector('.page-thumb-status')?.remove();wrap.insertBefore(img,wrap.firstChild)}
  }catch(e){console.warn('thumbnail',e);const status=wrap.querySelector('.page-thumb-status');if(status)status.textContent='Preview unavailable'}
}

function renderSplit(){
  const pdf=firstPdf();$('split-area').classList.toggle('active',state.mode==='split'&&!!pdf);
  if(!pdf)return;
  $('split-summary').textContent=`${pdf.name} · ${pdf.pages} pages`;
  const list=$('range-list');
  if(!state.splitRanges.length)list.innerHTML='<div class="empty-files">No ranges added yet.</div>';
  else list.innerHTML=state.splitRanges.map((r,i)=>`<div class="range-chip"><strong>Part ${i+1}</strong><span>Pages ${escapeHtml(r)}</span><button class="remove-file" type="button" aria-label="Remove split part ${i+1}" onclick="removeRange(${i})">✕</button></div>`).join('');
}
function setSplitError(message=''){const input=$('split-input'),error=$('split-error');input.setAttribute('aria-invalid',String(!!message));error.textContent=message;error.hidden=!message}
function validateRange(str,total){
  const parts=str.split(',').map(p=>p.trim());
  if(!parts.length||parts.some(p=>!p))return'Use page numbers separated by commas, such as 1-3,5.';
  for(const part of parts){const match=part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);if(!match)return`“${part}” is not a valid page or range.`;const nums=[+match[1],match[2]?+match[2]:null].filter(n=>n!==null);if(nums.some(n=>n<1||n>total))return`Choose pages between 1 and ${total}.`}
  return'';
}
function addRange(){const v=$('split-input').value.trim(),pdf=firstPdf();if(!v)return setSplitError('Enter a page or range first.');const error=validateRange(v,pdf?.pages||0);if(error)return setSplitError(error);setSplitError();state.splitRanges.push(v);$('split-input').value='';renderSplit();updateExportState()}
function removeRange(i){state.splitRanges.splice(i,1);renderSplit();updateExportState()}
function autoSplit(){const pdf=firstPdf();if(!pdf)return toast('Add a PDF first','error');setSplitError();state.splitRanges=Array.from({length:pdf.pages},(_,i)=>String(i+1));renderSplit();updateExportState();toast(`${pdf.pages} PDFs will be downloaded. Your browser may ask to allow multiple downloads.`,'success')}
function parseRange(str,total){const out=[],seen=new Set();str.split(',').forEach(part=>{part=part.trim();const m=part.match(/^(\d+)\s*-\s*(\d+)$/);if(m){const a=+m[1],b=+m[2],step=a<=b?1:-1;for(let n=a;step>0?n<=b:n>=b;n+=step)if(n>=1&&n<=total&&!seen.has(n)){seen.add(n);out.push(n)}}else if(/^\d+$/.test(part)){const n=+part;if(n>=1&&n<=total&&!seen.has(n)){seen.add(n);out.push(n)}}});return out}

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
async function imageAspect(dataUrl){const img=await loadImage(dataUrl);return img.naturalHeight/Math.max(1,img.naturalWidth)}
async function useSignature(){
  let data=null;if(state.signatureMode==='draw')data=window.getDrawSignature?.();else{const t=$('sig-type-input').value.trim();if(t)data=makeTypedSignature(t)}
  if(!data)return toast(state.signatureMode==='draw'?'Draw a signature first':'Type your name first','error');
  state.signatureDataUrl=data;state.signatureAspect=await imageAspect(data);$('sig-preview').innerHTML=`<img src="${data}" alt="Current signature">`;toast('Signature ready — click the document to place it','success');updateExportState();
}

async function renderSignPage(){
  const pdf=firstPdf();if(!pdf||state.mode!=='sign')return;
  const token=++state.signRenderToken,fileId=pdf.id;
  try{state.signRenderTask?.cancel()}catch(e){}
  state.signPage=Math.max(0,Math.min(state.signPage,pdf.pages-1));const pageIndex=state.signPage;$('sign-page-label').textContent=`Page ${pageIndex+1} / ${pdf.pages}`;$('sign-prev').disabled=pageIndex===0;$('sign-next').disabled=pageIndex===pdf.pages-1;
  try{
    const page=await pdf.pdfDoc.getPage(pageIndex+1),base=page.getViewport({scale:1});const maxW=Math.min(820,Math.max(320,$('sign-stage-wrap').clientWidth-34));const vp=page.getViewport({scale:maxW/base.width});const temp=document.createElement('canvas');temp.width=Math.round(vp.width);temp.height=Math.round(vp.height);const task=page.render({canvasContext:temp.getContext('2d'),viewport:vp});state.signRenderTask=task;await task.promise;
    if(token!==state.signRenderToken||state.mode!=='sign'||firstPdf()?.id!==fileId||state.signPage!==pageIndex)return;
    const cv=$('sign-canvas');cv.width=temp.width;cv.height=temp.height;cv.style.width=cv.width+'px';cv.style.height=cv.height+'px';cv.getContext('2d').drawImage(temp,0,0);
    const stage=$('sign-stage');stage.style.width=cv.width+'px';stage.style.height=cv.height+'px';renderPlacements();updateStats();
  }catch(e){if(e?.name!=='RenderingCancelledException'){console.error(e);toast('Could not render this PDF page','error')}}finally{if(token===state.signRenderToken)state.signRenderTask=null}
}
function changeSignPage(delta){const pdf=firstPdf();if(!pdf)return;state.signPage=Math.max(0,Math.min(pdf.pages-1,state.signPage+delta));state.selectedPlacement=null;renderSignPage()}
function placementHeight(p,stage=$('sign-stage')){const r=stage.getBoundingClientRect();return p.w*(r.width/Math.max(1,r.height))*(p.aspect||.25)}
function placeSignature(e){
  if(e.target.closest('.sig-placement'))return;if(!state.signatureDataUrl)return toast('Create a signature first','error');
  const stage=$('sign-stage'),r=stage.getBoundingClientRect();let w=(+$('sig-size').value||26)/100;let x=(e.clientX-r.left)/r.width-w/2;const draft={w,aspect:state.signatureAspect};let y=(e.clientY-r.top)/r.height-placementHeight(draft,stage)/2;x=Math.max(0,Math.min(1-w,x));y=Math.max(0,Math.min(1-placementHeight(draft,stage),y));
  const p={id:state.nextId++,pageIndex:state.signPage,x,y,w,aspect:state.signatureAspect,dataUrl:state.signatureDataUrl};state.placements.push(p);state.selectedPlacement=p.id;renderPlacements();updateExportState();
}
function renderPlacements(){
  const stage=$('sign-stage');stage.querySelectorAll('.sig-placement').forEach(n=>n.remove());
  state.placements.filter(p=>p.pageIndex===state.signPage).forEach(p=>{
    const el=document.createElement('div');el.className='sig-placement'+(p.id===state.selectedPlacement?' selected':'');el.dataset.id=p.id;el.tabIndex=0;el.setAttribute('role','group');el.setAttribute('aria-label',`Signature on page ${p.pageIndex+1}. Use arrow keys to move; Delete to remove.`);el.style.left=(p.x*100)+'%';el.style.top=(p.y*100)+'%';el.style.width=(p.w*100)+'%';el.innerHTML=`<img src="${p.dataUrl}" alt=""><button class="sig-remove" type="button" aria-label="Remove signature from page ${p.pageIndex+1}">✕</button>`;
    el.onclick=ev=>{ev.stopPropagation();state.selectedPlacement=p.id;$('sig-size').value=Math.round(p.w*100);renderPlacements()};
    el.onfocus=()=>{state.selectedPlacement=p.id;stage.querySelectorAll('.sig-placement').forEach(node=>node.classList.toggle('selected',node===el));$('sig-size').value=Math.round(p.w*100)};
    el.onkeydown=ev=>nudgePlacement(ev,p);
    el.querySelector('.sig-remove').onclick=ev=>{ev.stopPropagation();state.placements=state.placements.filter(x=>x.id!==p.id);if(state.selectedPlacement===p.id)state.selectedPlacement=null;renderPlacements();updateExportState()};
    el.addEventListener('pointerdown',ev=>startPlacementDrag(ev,p));stage.appendChild(el);
  });
}
function startPlacementDrag(e,p){
  if(e.target.closest('.sig-remove'))return;e.preventDefault();state.selectedPlacement=p.id;const stage=$('sign-stage'),r=stage.getBoundingClientRect(),sx=e.clientX,sy=e.clientY,ox=p.x,oy=p.y;
  const move=ev=>{p.x=Math.max(0,Math.min(1-p.w,ox+(ev.clientX-sx)/r.width));p.y=Math.max(0,Math.min(1-placementHeight(p,stage),oy+(ev.clientY-sy)/r.height));const el=stage.querySelector(`[data-id="${p.id}"]`);if(el){el.style.left=p.x*100+'%';el.style.top=p.y*100+'%'}};
  const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);renderPlacements()};window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up)
}
function nudgePlacement(e,p){const keys={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};if((e.key==='Delete'||e.key==='Backspace')){e.preventDefault();state.placements=state.placements.filter(x=>x.id!==p.id);state.selectedPlacement=null;renderPlacements();updateExportState();return}if(!keys[e.key])return;e.preventDefault();const step=(e.shiftKey ? 0.02 : 0.005),[dx,dy]=keys[e.key];p.x=Math.max(0,Math.min(1-p.w,p.x+dx*step));p.y=Math.max(0,Math.min(1-placementHeight(p),p.y+dy*step));renderPlacements();setTimeout(()=>$('sign-stage').querySelector(`[data-id="${p.id}"]`)?.focus(),0)}
function resizeSelected(){const p=state.placements.find(x=>x.id===state.selectedPlacement);if(p){p.w=(+$('sig-size').value)/100;p.x=Math.min(p.x,1-p.w);p.y=Math.min(p.y,1-placementHeight(p));renderPlacements()}}
function undoPlacement(){state.placements.pop();state.selectedPlacement=null;renderPlacements();updateExportState()}
function clearPlacements(){state.placements=[];state.selectedPlacement=null;renderPlacements();updateExportState()}

async function exportCurrent(){if(state.busy)return;state.busy=true;updateExportState();try{if(state.mode==='merge')await runMerge();else if(state.mode==='split')await runSplit();else await runSign()}finally{state.busy=false;updateExportState()}}
async function runMerge(){
  if(!state.pageOrder.length)return toast('Add at least one file','error');progress('Building your PDF…',8);
  try{const out=await PDFLib.PDFDocument.create(),cache=new Map();for(let i=0;i<state.pageOrder.length;i++){const item=state.pageOrder[i],f=fileById(item.fileId);if(f.isPdf){let src=cache.get(f.id);if(!src){src=await PDFLib.PDFDocument.load(f.bytes);cache.set(f.id,src)}const[pg]=await out.copyPages(src,[item.pageNum-1]);pg.setRotation(PDFLib.degrees((pg.getRotation().angle+(item.rotation||0))%360));out.addPage(pg)}else{const img=await embedFileImage(out,f);if(!img)throw new Error(`Could not convert ${f.name}`);const d=img.scale(1),page=out.addPage([d.width,d.height]);page.drawImage(img,{x:0,y:0,width:d.width,height:d.height});page.setRotation(PDFLib.degrees(item.rotation||0))}setProgress(8+82*(i+1)/state.pageOrder.length)}const bytes=await out.save();download(bytes,filename('merged'));toast(`${out.getPageCount()} pages merged`,'success')}catch(e){console.error(e);toast('Could not merge these files. Check that every file is supported.','error')}finally{hideProgress()}
}
async function embedFileImage(doc,f){const ext=(f.name.split('.').pop()||'').toLowerCase(),buf=await f.file.arrayBuffer();if(ext==='jpg'||ext==='jpeg'||f.file.type==='image/jpeg')return doc.embedJpg(buf);if(ext==='png'||f.file.type==='image/png')return doc.embedPng(buf);return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>{try{const c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;c.getContext('2d').drawImage(im,0,0);c.toBlob(async b=>{try{if(!b)throw new Error('Image conversion failed');resolve(await doc.embedPng(await b.arrayBuffer()))}catch(e){reject(e)}},'image/png')}catch(e){reject(e)}};im.onerror=()=>reject(new Error('Image decode failed'));im.src=f.imgUrl})}
async function runSplit(){
  const pdf=firstPdf();if(!pdf)return toast('Add a PDF first','error');if(!state.splitRanges.length)return toast('Add at least one page range','error');progress('Splitting PDF…',8);
  try{const src=await PDFLib.PDFDocument.load(pdf.bytes),total=src.getPageCount(),parts=state.splitRanges.map(range=>({range,nums:parseRange(range,total)}));const invalid=parts.find(part=>validateRange(part.range,total)||!part.nums.length);if(invalid)throw new Error(`Invalid range: ${invalid.range}`);let created=0;for(const part of parts){const out=await PDFLib.PDFDocument.create(),pages=await out.copyPages(src,part.nums.map(n=>n-1));pages.forEach(p=>out.addPage(p));created++;download(await out.save(),`${baseName()}-part-${created}.pdf`);setProgress(8+82*created/parts.length);await new Promise(r=>setTimeout(r,300))}toast(`${created} PDF${created!==1?'s':''} downloaded${created>1?'. Allow multiple downloads if your browser asks.':''}`,'success')}catch(e){console.error(e);toast('Could not split this PDF. Check the page ranges.','error')}finally{hideProgress()}
}
async function runSign(){
  const pdf=firstPdf();if(!pdf)return toast('Add a PDF first','error');if(!state.placements.length)return toast('Place at least one signature','error');progress('Applying signatures…',12);
  try{const doc=await PDFLib.PDFDocument.load(pdf.bytes),cache=new Map();if(state.placements.some(p=>p.pageIndex<0||p.pageIndex>=doc.getPageCount()))throw new Error('Signature page no longer exists');for(let i=0;i<state.placements.length;i++){const p=state.placements[i];let img=cache.get(p.dataUrl);if(!img){img=await doc.embedPng(await dataUrlBytes(p.dataUrl));cache.set(p.dataUrl,img)}const page=doc.getPage(p.pageIndex),pw=page.getWidth(),ph=page.getHeight(),w=p.w*pw,h=w*(img.height/img.width),x=Math.max(0,Math.min(p.x*pw,pw-w)),y=Math.max(0,ph-p.y*ph-h);page.drawImage(img,{x,y,width:w,height:h});setProgress(12+78*(i+1)/state.placements.length)}download(await doc.save(),filename('signed'));toast('Visually signed PDF downloaded','success')}catch(e){console.error(e);toast('Could not create the signed PDF','error')}finally{hideProgress()}
}
function dataUrlBytes(url){return fetch(url).then(r=>r.arrayBuffer()).then(b=>new Uint8Array(b))}
function safeName(value,fallback){return(value.trim()||fallback).replace(/\.pdf$/i,'').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'-').replace(/[. ]+$/g,'').slice(0,120)||fallback}
function baseName(){return safeName($('output-name').value,state.mode||'document')}
function filename(fallback){return safeName($('output-name').value,fallback)+'.pdf'}
function download(bytes,name){const u=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'})),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),6000)}

async function fetchRemote(url,name){if(!url)return toast('Enter a URL','error');if(!/^https:\/\//i.test(url))return toast('Remote imports require an HTTPS URL','error');progress('Fetching file through the server…',18);try{const r=await fetch(`/api/proxy?url=${encodeURIComponent(url)}`);if(!r.ok)throw new Error(String(r.status));const b=await r.blob(),type=(b.type||'').split(';')[0],ext=type==='image/jpeg'?'.jpg':type==='image/png'?'.png':type==='image/webp'?'.webp':'.pdf',raw=name||new URL(url).pathname.split('/').pop()||`imported${ext}`,n=/\.(pdf|jpe?g|png|webp)$/i.test(raw)?raw:raw+ext;await addFiles([new File([b],n,{type})],'remote')}catch(e){console.error(e);toast('Could not fetch that file. Check the link and file type.','error')}finally{hideProgress()}}
function importUrl(){const v=$('url-input').value.trim();$('url-input').value='';fetchRemote(v)}
function importDrive(){const v=$('drive-input').value.trim();const m=v.match(/\/d\/([a-zA-Z0-9_-]+)/)||v.match(/[?&]id=([a-zA-Z0-9_-]+)/);if(!m)return toast('Paste a valid shareable Drive link','error');$('drive-input').value='';fetchRemote(`https://drive.google.com/uc?export=download&id=${m[1]}`,`drive-${m[1]}.pdf`)}

function updateStats(){const pdf=firstPdf();if(state.mode==='merge')$('canvas-stats').textContent=`${state.pageOrder.length} page${state.pageOrder.length!==1?'s':''} · ${state.files.length} file${state.files.length!==1?'s':''}`;else if(state.mode==='split')$('canvas-stats').textContent=pdf?`${pdf.pages} pages · ${state.splitRanges.length} range${state.splitRanges.length!==1?'s':''}`:'No PDF';else $('canvas-stats').textContent=pdf?`${pdf.pages} pages · ${state.placements.length} signature${state.placements.length!==1?'s':''}`:'No PDF'}
function updateExportState(){let ok=false;if(state.mode==='merge')ok=state.pageOrder.length>0;if(state.mode==='split')ok=!!firstPdf()&&state.splitRanges.length>0;if(state.mode==='sign')ok=!!firstPdf()&&state.placements.length>0;$('export-btn').disabled=!ok||state.busy;updateStats()}
function progress(label,pct){$('progress').classList.add('show');$('progress-label').textContent=label;document.querySelector('.workspace')?.setAttribute('aria-busy','true');setProgress(pct)}function setProgress(p){const value=Math.round(Math.max(0,Math.min(100,p)));$('progress-fill').style.width=Math.max(4,value)+'%';$('progress-track').setAttribute('aria-valuenow',String(value));$('progress-percent').textContent=value+'%'}function hideProgress(){setProgress(100);setTimeout(()=>{$('progress').classList.remove('show');document.querySelector('.workspace')?.removeAttribute('aria-busy')},250)}
let toastTimer;function toast(msg,type=''){const t=$('toast');t.textContent=msg;t.className='toast show '+type;t.setAttribute('role',type==='error'?'alert':'status');t.setAttribute('aria-live',type==='error'?'assertive':'polite');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.className='toast',5000)}
function toggleTheme(){const root=document.documentElement;root.dataset.theme=root.dataset.theme==='light'?'dark':'light';localStorage.setItem('fold-theme',root.dataset.theme);$('theme-btn').setAttribute('aria-pressed',String(root.dataset.theme==='light'));$('theme-btn').setAttribute('aria-label',root.dataset.theme==='light'?'Use dark theme':'Use light theme')}

function bind(){
  document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
  const dz=$('dropzone'),fi=$('file-input');dz.onclick=()=>fi.click();dz.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();fi.click()}};fi.onchange=e=>{addFiles([...e.target.files]);fi.value=''};
  dz.ondragover=e=>{e.preventDefault();dz.classList.add('over')};dz.ondragleave=()=>dz.classList.remove('over');dz.ondrop=e=>{e.preventDefault();dz.classList.remove('over');addFiles([...e.dataTransfer.files])};
  $('clear-files').onclick=clearFiles;$('add-range').onclick=addRange;$('auto-split').onclick=autoSplit;$('split-input').oninput=()=>setSplitError();$('split-input').onkeydown=e=>{if(e.key==='Enter')addRange()};$('export-btn').onclick=exportCurrent;
  $('sig-draw-tab').onclick=()=>setSignatureMode('draw');$('sig-type-tab').onclick=()=>setSignatureMode('type');$('use-signature').onclick=useSignature;$('sig-size').oninput=resizeSelected;
  $('sign-prev').onclick=()=>changeSignPage(-1);$('sign-next').onclick=()=>changeSignPage(1);$('sign-stage').onclick=placeSignature;$('undo-placement').onclick=undoPlacement;$('clear-placements').onclick=clearPlacements;
  $('fetch-url').onclick=importUrl;$('import-drive').onclick=importDrive;$('theme-btn').onclick=toggleTheme;
  window.addEventListener('dragover',e=>{if(e.dataTransfer?.types?.includes('Files'))e.preventDefault()});window.addEventListener('drop',e=>{if(e.dataTransfer?.types?.includes('Files')&&!e.target.closest('#dropzone'))e.preventDefault()});
}

document.addEventListener('DOMContentLoaded',()=>{const saved=localStorage.getItem('fold-theme');if(saved)document.documentElement.dataset.theme=saved;bind();initSignaturePad();$('theme-btn').setAttribute('aria-pressed',String(document.documentElement.dataset.theme==='light'));const mode=new URLSearchParams(location.search).get('mode');setMode(['merge','split','sign'].includes(mode)?mode:'merge');renderAll()});
