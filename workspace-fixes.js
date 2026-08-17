// Small compatibility fixes layered after the main workspace controller.
// Keep the primary controller focused while avoiding duplicate PDF.js renders.
if(typeof renderAll==='function'){
  renderAll=function(){
    renderFileList();
    renderMergeGrid();
    renderSplit();
    setMode(state.mode);
  };
}

// Signature placements and split ranges belong to the active/first PDF.
// If that PDF changes, clear document-specific state instead of carrying it over.
if(typeof removeFile==='function'){
  removeFile=function(id){
    const before=firstPdf()?.id??null;
    const f=fileById(id);
    if(f?.imgUrl)URL.revokeObjectURL(f.imgUrl);
    state.files=state.files.filter(file=>file.id!==id);
    state.pageOrder=state.pageOrder.filter(page=>page.fileId!==id);
    const after=firstPdf()?.id??null;
    if(before!==after){
      state.splitRanges=[];
      state.placements=[];
      state.signPage=0;
      state.selectedPlacement=null;
    }
    renderAll();
  };
}

document.addEventListener('DOMContentLoaded',()=>{
  const refreshSignatureCanvas=()=>setTimeout(()=>window.dispatchEvent(new Event('resize')),80);
  document.querySelectorAll('[data-mode]').forEach(btn=>btn.addEventListener('click',()=>{if(btn.dataset.mode==='sign')refreshSignatureCanvas()}));
  document.getElementById('sig-draw-tab')?.addEventListener('click',refreshSignatureCanvas);
  if(new URLSearchParams(location.search).get('mode')==='sign')refreshSignatureCanvas();
});