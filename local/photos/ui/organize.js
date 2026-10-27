(() => {
  let summary;
  function options(select, values, first, selected) {
    select.replaceChildren(node('option','',first)); select.firstChild.value = '';
    Object.entries(values).forEach(([value,label]) => { const option = node('option','',label); option.value = value; select.append(option); });
    select.value = selected || '';
  }
  async function refresh() {
    summary = await api('/api/organize');
    options($('#content-type'),summary.type_labels,'全部类型',state.mediaType);
    options($('#content-category'),summary.taxonomy,'全部内容',state.category);
    $('#search-mode').value = state.mode;
    const filters = [state.mediaType,state.category,state.month,state.album].filter(Boolean).length;
    $('.filter-menu summary').textContent = filters ? `筛选 · ${filters}` : '筛选';
  }
  async function renderPhoto(photo) {
    if (!summary) { try { summary = await api('/api/organize'); } catch { return; } }
    if (state.photos[state.current]?.id !== photo.id) return;
    options($('#photo-category'),summary.taxonomy,`自动分类 · ${photo.category_label}`,photo.custom_category);
    options($('#photo-media-type'),summary.type_labels,`自动类型 · ${photo.media_type_label}`,photo.custom_media_type);
    $('#photo-review').value = photo.review === 'delete' ? 'unreviewed' : photo.review;
    $('#photo-ocr').hidden = !photo.ocr_text; $('#ocr-text').textContent = photo.ocr_text || '';
    let detail = $('#photo-content-review');
    if (!detail) { detail = node('p','photo-description'); detail.id = 'photo-content-review'; $('#photo-date').after(detail); }
    detail.hidden = !photo.content_review; detail.textContent = photo.content_review?.description || '';
  }
  $('#content-type').addEventListener('change',event=>{state.mediaType=event.target.value;load().catch(showError);});
  $('#content-category').addEventListener('change',event=>{state.category=event.target.value;load().catch(showError);});
  $('#search-mode').addEventListener('change',event=>{state.mode=event.target.value;load().catch(showError);});
  window.PhotoOrganizer = {refresh,renderPhoto};
})();
