// Compatibility and UX enhancements layered after the main workspace controller.
// Keep the primary controller focused while avoiding duplicate PDF.js renders.
if(typeof renderAll==='function'){
  renderAll=function(){
    renderFileList();
    renderMergeGrid();
    renderSplit();
    setMode(state.mode);
  };
}

// ── Split preview grid ──
(function enhanceSplitPreview(){
  const style=document.createElement('style');
  style.textContent=`
    .split-preview-shell{margin-top:18px;border-top:1px solid var(--border);padding-top:18px}
    .split-preview-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:12px}
    .split-preview-head h4{margin:0;font-size:13px;color:var(--text)}
    .split-preview-head p{margin:4px 0 0;font-size:10px;color:var(--muted);line-height:1.5}
    .split-preview-count{font-size:10px;color:var(--muted);white-space:nowrap}
    .split-preview-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:12px}
    .split-page-card{appearance:none;border:1px solid var(--border);background:var(--surface);border-radius:10px;padding:8px;text-align:left;color:var(--text);cursor:pointer;transition:border-color .16s ease,transform .16s ease,box-shadow .16s ease;min-width:0}
    .split-page-card:hover{border-color:var(--accent);transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.16)}
    .split-page-card.in-range{border-color:color-mix(in srgb,var(--accent) 70%,var(--border));background:color-mix(in srgb,var(--accent) 7%,var(--surface));box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 22%,transparent)}
    .split-page-paper{position:relative;aspect-ratio:.707;background:#fff;border-radius:6px;overflow:hidden;box-shadow:0 3px 12px rgba(0,0,0,.18)}
    .split-page-paper canvas{display:block;width:100%;height:100%;object-fit:contain}
    .split-page-loading{position:absolute;inset:0;display:grid;place-items:center;color:#999;font-size:10px;background:#f4f4f4}
    .split-page-num{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;font-size:10px;color:var(--muted)}
    .split-page-num strong{font-size:11px;color:var(--text)}
    .split-page-status{font-size:9px;color:var(--accent);font-weight:700;opacity:0}
    .split-page-card.in-range .split-page-status{opacity:1}
    .split-preview-note{font-size:10px;color:var(--muted);padding:12px;border:1px dashed var(--border);border-radius:8px;margin-top:12px}
    @media(max-width:700px){.split-preview-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.split-page-card{padding:6px}.split-preview-head{align-items:flex-start;flex-direction:column;gap:5px}}
    @media(max-width:440px){.split-preview-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  `;
  document.head.appendChild(style);

  let previewToken=0;
  let originalRenderSplit=null;

  function selectedPages(pdf){
    const selected=new Set();
    if(!pdf)return selected;
    state.splitRanges.forEach(r=>parseRange(r,pdf.pages).forEach(n=>selected.add(n)));
    return selected;
  }

  function ensurePreviewShell(){
    const area=document.getElementById('split-area');
    if(!area)return null;
    let shell=document.getElementById('split-preview-shell');
    if(shell)return shell;
    shell=document.createElement('div');
    shell.id='split-preview-shell';
    shell.className='split-preview-shell';
    shell.innerHTML=`
      <div class="split-preview-head">
        <div><h4>Page preview</h4><p>Click a page to add its number to the range field. Pages included in saved ranges are highlighted.</p></div>
        <span class="split-preview-count" id="split-preview-count"></span>
      </div>
      <div class="split-preview-grid" id="split-preview-grid" aria-label="Split PDF page previews"></div>
      <div class="split-preview-note" id="split-preview-note" style="display:none"></div>`;
    const rangeList=document.getElementById('range-list');
    area.insertBefore(shell,rangeList || null);
    return shell;
  }

  function appendPageToInput(pageNum){
    const input=document.getElementById('split-input');
    if(!input)return;
    const current=input.value.trim();
    const parts=current ? current.split(',').map(x=>x.trim()).filter(Boolean) : [];
    const value=String(pageNum);
    if(!parts.includes(value))parts.push(value);
    input.value=parts.join(',');
    input.focus();
    input.setSelectionRange(input.value.length,input.value.length);
  }

  async function renderSplitPreviews(){
    const pdf=firstPdf();
    const shell=ensurePreviewShell();
    if(!shell)return;
    const grid=document.getElementById('split-preview-grid');
    const count=document.getElementById('split-preview-count');
    const note=document.getElementById('split-preview-note');
    if(!pdf || state.mode!=='split'){
      grid.innerHTML='';
      count.textContent='';
      note.style.display='none';
      return;
    }

    const token=++previewToken;
    const selected=selectedPages(pdf);
    const maxPreview=80;
    const previewPages=Math.min(pdf.pages,maxPreview);
    count.textContent=`${pdf.pages} page${pdf.pages!==1?'s':''}`;
    grid.innerHTML='';

    const cards=[];
    for(let pageNum=1;pageNum<=previewPages;pageNum++){
      const card=document.createElement('button');
      card.type='button';
      card.className='split-page-card'+(selected.has(pageNum)?' in-range':'');
      card.dataset.page=String(pageNum);
      card.setAttribute('aria-label',`Page ${pageNum}${selected.has(pageNum)?', included in a split range':''}`);
      card.innerHTML=`<div class="split-page-paper"><div class="split-page-loading">Loading…</div></div><div class="split-page-num"><strong>Page ${pageNum}</strong><span class="split-page-status">Selected</span></div>`;
      card.onclick=()=>appendPageToInput(pageNum);
      grid.appendChild(card);
      cards.push({card,pageNum});
    }

    note.style.display=pdf.pages>maxPreview?'block':'none';
    if(pdf.pages>maxPreview)note.textContent=`Showing the first ${maxPreview} pages to keep the workspace responsive. You can still type any page number up to ${pdf.pages} in the range field.`;

    // Render thumbnails in small batches so long PDFs do not freeze the UI.
    for(let start=0;start<cards.length;start+=8){
      if(token!==previewToken || state.mode!=='split' || firstPdf()?.id!==pdf.id)return;
      const batch=cards.slice(start,start+8);
      await Promise.all(batch.map(async ({card,pageNum})=>{
        try{
          const page=await pdf.pdfDoc.getPage(pageNum);
          const base=page.getViewport({scale:1});
          const viewport=page.getViewport({scale:180/base.width});
          const canvas=document.createElement('canvas');
          canvas.width=Math.max(1,Math.round(viewport.width));
          canvas.height=Math.max(1,Math.round(viewport.height));
          await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
          if(token!==previewToken || !card.isConnected)return;
          const paper=card.querySelector('.split-page-paper');
          paper.innerHTML='';
          paper.appendChild(canvas);
        }catch(e){
          const loading=card.querySelector('.split-page-loading');
          if(loading)loading.textContent='Preview unavailable';
        }
      }));
      await new Promise(r=>setTimeout(r,0));
    }
  }

  function updateSplitHighlights(){
    const pdf=firstPdf();
    if(!pdf)return;
    const selected=selectedPages(pdf);
    document.querySelectorAll('.split-page-card').forEach(card=>{
      const page=Number(card.dataset.page);
      const active=selected.has(page);
      card.classList.toggle('in-range',active);
      card.setAttribute('aria-label',`Page ${page}${active?', included in a split range':''}`);
    });
  }

  if(typeof renderSplit==='function'){
    originalRenderSplit=renderSplit;
    renderSplit=function(){
      originalRenderSplit();
      if(state.mode==='split'&&firstPdf()){
        const shell=ensurePreviewShell();
        const pdf=firstPdf();
        const existingPdf=shell?.dataset.pdfId;
        if(existingPdf!==String(pdf.id)){
          shell.dataset.pdfId=String(pdf.id);
          renderSplitPreviews();
        }else{
          updateSplitHighlights();
        }
      }else{
        const shell=document.getElementById('split-preview-shell');
        if(shell){shell.dataset.pdfId='';const grid=document.getElementById('split-preview-grid');if(grid)grid.innerHTML='';}
      }
    };
  }

  // Re-render previews when Split mode is entered because the section may have been hidden.
  document.addEventListener('DOMContentLoaded',()=>{
    document.querySelectorAll('[data-mode="split"]').forEach(btn=>btn.addEventListener('click',()=>setTimeout(renderSplitPreviews,20)));
  });
})();

document.addEventListener('DOMContentLoaded',()=>{
  const refreshSignatureCanvas=()=>setTimeout(()=>window.dispatchEvent(new Event('resize')),80);
  document.querySelectorAll('[data-mode]').forEach(btn=>btn.addEventListener('click',()=>{if(btn.dataset.mode==='sign')refreshSignatureCanvas()}));
  document.getElementById('sig-draw-tab')?.addEventListener('click',refreshSignatureCanvas);
  if(new URLSearchParams(location.search).get('mode')==='sign')refreshSignatureCanvas();
});