(() => {
  const selected = new Set(); let summary, timer;
  const reviews = { unreviewed: '待复核', keep: '保留', delete: '待删除' };
  async function refresh() {
    summary = await api('/api/organize');
    $('#organized-count').textContent = formatNumber(summary.analyzed); $('#embedding-count').textContent = formatNumber(summary.embeddings);
    $('#review-count').textContent = formatNumber(summary.reviews.unreviewed); $('#delete-count').textContent = formatNumber(summary.reviews.delete);
    $('#organize-nav-count').textContent = formatNumber(summary.analyzed);
    $('#analysis-status').textContent = summary.status.message + ` 图像向量 ${formatNumber(summary.embeddings)}/${formatNumber(summary.total)}；OCR 和分类结果只保存在本机。`;
    $('#analysis-start').disabled = summary.status.phase === 'running' || !summary.model.available; $('#analysis-stop').hidden = summary.status.phase !== 'running';
    const categories = $('#content-categories'); categories.replaceChildren();
    const add = (key, label, count) => { const button = node('button', `category-chip${state.category === key ? ' active' : ''}`); button.append(document.createTextNode(label), node('span', '', formatNumber(count))); button.addEventListener('click', () => { state.category = key; selected.clear(); load().catch(showError); }); categories.append(button); };
    const counts = state.mediaType && summary.hierarchy ? summary.hierarchy[state.mediaType] || {} : summary.categories;
    add('', state.mediaType ? `${summary.type_labels[state.mediaType]}中的全部内容` : '全部内容', state.mediaType ? summary.types[state.mediaType] : summary.total);
    Object.entries(summary.taxonomy).forEach(([key, label]) => add(key, label, counts[key]));
    const types = $('#content-type'); types.replaceChildren(node('option', '', '全部类型')); types.firstChild.value = '';
    Object.entries(summary.type_labels).forEach(([key, label]) => { const option = node('option', '', `${label}（${summary.types[key] || 0}）`); option.value = key; types.append(option); }); types.value = state.mediaType;
    $('#content-review').value = state.review; $('#search-mode').value = state.mode; $('#only-unprocessed').checked = state.unprocessed;
    selectionStatus();
    clearTimeout(timer);
    if (summary.status.phase === 'running') timer = setTimeout(async () => { if (state.view === 'organize' && !$('#photo-dialog').open) { try { await load(); } catch (error) { showError(error); } } }, 3000);
  }
  function selectionStatus() { $('#selected-count').textContent = selected.size ? `已选择 ${selected.size} 张` : '未选择照片'; ['review-keep', 'review-delete', 'review-reset'].forEach(id => { $(`#${id}`).disabled = !selected.size; }); }
  function decorate(element, photo) {
    const checkbox = node('input', 'organize-select'); checkbox.type = 'checkbox'; checkbox.checked = selected.has(photo.id); checkbox.setAttribute('aria-label', `选择 ${photo.filename}`);
    checkbox.addEventListener('change', () => { checkbox.checked ? selected.add(photo.id) : selected.delete(photo.id); selectionStatus(); });
    element.append(checkbox);
    const labels = node('div', 'organization-labels'); labels.append(node('span', '', `${photo.media_type_label} · ${photo.category_label}`), node('small', `review-label ${photo.review}`, reviews[photo.review]));
    if (photo.analyzed && !photo.classification_confirmed) labels.firstChild.title = photo.analysis_uncertain ? '建议不明确，请人工复核。' : '模型建议，尚未人工确认。';
    element.append(labels);
  }
  async function review(value) { try { const ids = [...selected]; for (let start = 0; start < ids.length; start += 200) await api('/api/review', { ids: ids.slice(start, start + 200), review: value }); selected.clear(); await load(); toast('复核状态已保存，原图没有删除。'); } catch (error) { toast(error.message); } }
  async function renderPhoto(photo) {
    if (!summary) { try { summary = await api('/api/organize'); } catch { return; } }
    if (state.photos[state.current]?.id !== photo.id) return;
    const categories = $('#photo-category'); categories.replaceChildren(node('option', '', `使用建议分类（${photo.category_label}）`)); categories.firstChild.value = '';
    Object.entries(summary.taxonomy).forEach(([key, label]) => { const option = node('option', '', label); option.value = key; categories.append(option); }); categories.value = photo.custom_category || '';
    const types = $('#photo-media-type'); types.replaceChildren(node('option', '', `使用自动类型（${photo.media_type_label}）`)); types.firstChild.value = '';
    Object.entries(summary.type_labels).forEach(([key, label]) => { const option = node('option', '', label); option.value = key; types.append(option); }); types.value = photo.custom_media_type || '';
    $('#photo-review').value = photo.review;
    $('#photo-ocr').hidden = !photo.ocr_text; $('#ocr-text').textContent = photo.ocr_text || '';
  }
  $('#content-type').addEventListener('change', event => { state.mediaType = event.target.value; selected.clear(); load().catch(showError); });
  $('#content-review').addEventListener('change', event => { state.review = event.target.value; selected.clear(); load().catch(showError); });
  $('#search-mode').addEventListener('change', event => { state.mode = event.target.value; load().catch(showError); });
  $('#only-unprocessed').addEventListener('change', event => { state.unprocessed = event.target.checked; load().catch(showError); });
  $('#select-page').addEventListener('click', () => { state.photos.forEach(photo => selected.add(photo.id)); renderGallery(); selectionStatus(); });
  $('#review-keep').addEventListener('click', () => review('keep')); $('#review-delete').addEventListener('click', () => review('delete')); $('#review-reset').addEventListener('click', () => review('unreviewed'));
  $('#analysis-start').addEventListener('click', async () => { try { await api('/api/analysis/start', { limit: $('#analysis-limit').value ? Number($('#analysis-limit').value) : null }); await refresh(); } catch (error) { toast(error.message); } });
  $('#analysis-stop').addEventListener('click', async () => { await api('/api/analysis/stop', {}); toast('将在当前批次完成后停止，已完成的结果会保留。'); });
  window.PhotoOrganizer = { refresh, decorate, renderPhoto };
})();
