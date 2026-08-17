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

document.addEventListener('DOMContentLoaded',()=>{
  const refreshSignatureCanvas=()=>setTimeout(()=>window.dispatchEvent(new Event('resize')),80);
  document.querySelectorAll('[data-mode]').forEach(btn=>btn.addEventListener('click',()=>{if(btn.dataset.mode==='sign')refreshSignatureCanvas()}));
  document.getElementById('sig-draw-tab')?.addEventListener('click',refreshSignatureCanvas);
  if(new URLSearchParams(location.search).get('mode')==='sign')refreshSignatureCanvas();
});