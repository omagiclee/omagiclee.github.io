(() => {
  'use strict';
  const section = document.getElementById('comments');
  if (!section?.dataset.server) return;
  const content = document.getElementById('content');
  const mount = document.getElementById('artalk-comments');
  const home = section.querySelector('.discussion-home');
  const panel = document.getElementById('discussion-panel');
  const toolbar = document.getElementById('selection-discussion');
  const status = section.querySelector('.discussion-status');
  const retry = section.querySelector('.discussion-retry');
  const preview = panel.querySelector('.discussion-quote-preview');
  const toast = document.querySelector('.discussion-toast');
  const blocks = content ? [...content.querySelectorAll('p, li, h2, h3, h4, blockquote')].filter(block => !block.closest('pre, table, .katex, svg, [data-no-annotation]')) : [];
  let artalk, loading, selection, quoted, returnFocus, toastTimer, panelRequest = 0;

  function message(text) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 4000);
  }
  function fingerprint(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return (hash >>> 0).toString(36);
  }
  const seen = new Map();
  blocks.forEach(block => {
    if (block.id) return;
    const key = fingerprint(block.textContent.trim());
    const occurrence = (seen.get(key) || 0) + 1;
    seen.set(key, occurrence);
    block.id = `passage-${key}${occurrence > 1 ? `-${occurrence}` : ''}`;
  });
  function headingFor(block) {
    let heading = '';
    for (const candidate of blocks) {
      if (candidate === block) break;
      if (/^H[234]$/.test(candidate.tagName)) heading = candidate.id;
    }
    return heading;
  }
  function contextURL(context) {
    const encoded = encodeURIComponent(JSON.stringify(context)).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16)}`);
    return `${section.dataset.pageKey}#quote=${encoded}`;
  }
  function showContext(context, updateHash = true) {
    if (!context || typeof context.text !== 'string' || context.text.length > 1200) return;
    let block = document.getElementById(context.id);
    if (!block || !content.contains(block) || !block.textContent.includes(context.text)) {
      block = blocks.find(item => item.textContent.includes(context.text));
    }
    if (!block) {
      block = document.getElementById(context.heading);
      if (!block || !content.contains(block)) { message('The quoted passage has changed.'); return; }
      message('The passage has changed. Showing its original section.');
    }
    document.querySelectorAll('.discussion-context-target').forEach(item => item.classList.remove('discussion-context-target'));
    block.classList.add('discussion-context-target');
    block.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    setTimeout(() => block.classList.remove('discussion-context-target'), 4500);
    if (updateHash) history.replaceState(null, '', contextURL(context));
  }
  function readHash() {
    if (!location.hash.startsWith('#quote=')) return;
    try { showContext(JSON.parse(decodeURIComponent(location.hash.slice(7))), false); } catch { /* A malformed link is inert. */ }
  }
  window.addEventListener('hashchange', readHash);
  if (location.hash.startsWith('#quote=')) requestAnimationFrame(readHash);
  mount.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link) return;
    try {
      const url = new URL(link.href, location.href);
      if (url.origin !== location.origin || url.pathname !== section.dataset.pageKey || !url.hash.startsWith('#quote=')) return;
      const context = JSON.parse(decodeURIComponent(url.hash.slice(7)));
      event.preventDefault();
      if (panel.open) panel.close();
      showContext(context);
    } catch { /* Ordinary links retain Artalk's native behavior. */ }
  });

  function loadResource(tag, url, integrity) {
    return new Promise((resolve, reject) => {
      const node = document.createElement(tag);
      node.integrity = integrity;
      if (tag === 'script') { node.src = url; node.async = true; }
      else { node.rel = 'stylesheet'; node.href = url; }
      node.onload = resolve;
      node.onerror = () => { node.remove(); reject(new Error('Unable to load comment resources')); };
      document.head.appendChild(node);
    });
  }
  function setStatus(text, failed = false) {
    status.querySelector('span').textContent = text;
    retry.hidden = !failed;
    status.hidden = !text;
  }
  function ensureLoaded() {
    if (loading) return loading;
    if (artalk) return Promise.resolve(artalk);
    setStatus('Loading discussion…');
    loading = Promise.all([
      window.BlogArtalk ? Promise.resolve() : loadResource('script', section.dataset.runtime, section.dataset.runtimeIntegrity),
      document.querySelector('link[data-artalk-style]') ? Promise.resolve() : loadResource('link', section.dataset.styles, section.dataset.stylesIntegrity).then(() => {
        [...document.querySelectorAll('link')].find(link => link.getAttribute('href') === section.dataset.styles)?.setAttribute('data-artalk-style', '');
      }),
    ]).then(async () => {
      artalk = window.BlogArtalk.init({
        el: mount, server: section.dataset.server, site: section.dataset.site,
        pageKey: section.dataset.pageKey, pageTitle: section.dataset.pageTitle,
        locale: section.dataset.locale, darkMode: document.body.getAttribute('theme') === 'dark',
        placeholder: 'Ask a question or share your experience…', noComment: 'Start the conversation.',
        emoticons: false, imgUpload: false, pvEl: '.discussion-pv-unused', countEl: '.discussion-count',
        editorTravel: false, nestMax: 2, flatMode: 'auto', uaBadge: false, gravatar: { mirror: 'https://www.gravatar.com/avatar/' },
        scrollRelativeTo: () => panel.open ? panel : document.scrollingElement,
      });
      artalk.on('list-loaded', () => { setStatus(''); section.querySelector('.discussion-count').hidden = false; });
      artalk.on('list-failed', () => setStatus('The discussion is temporarily unavailable. Your draft is kept in the editor.', true));
      artalk.on('editor-submitted', () => { quoted = null; preview.hidden = true; message('Your reply has been submitted.'); });
      await new Promise(resolve => artalk.on('mounted', () => {
        const editor = artalk.ctx.inject('editor');
        const getContentFinal = editor.getContentFinal.bind(editor);
        // Keep the composer's draft human-readable. Add the quote through the
        // pinned client's final-content boundary, used for preview and submission.
        editor.getContentFinal = () => {
          const draft = getContentFinal();
          return quoted && editor.getState() !== 'edit'
            ? `${markdownQuote(quoted.text)}\n\n[View context](${contextURL(quoted)})\n\n${draft}`
            : draft;
        };
        Object.entries(editor.getHeaderInputEls()).forEach(([name, input]) => input.setAttribute('aria-label', name === 'name' ? 'Nickname' : name === 'email' ? 'Email' : 'Website (optional)'));
        editor.getUI().$textarea.setAttribute('aria-label', 'Your comment');
        if (panel.open) panel.appendChild(artalk.ctx.inject('layers').getEl());
        resolve();
      }));
      return artalk;
    }).catch(error => {
      loading = null;
      setStatus('Unable to load the discussion. Please try again.', true);
      throw error;
    });
    return loading;
  }
  retry.addEventListener('click', () => { if (artalk) { setStatus('Loading discussion…'); artalk.reload(); } else ensureLoaded().catch(() => {}); });
  const themeObserver = new MutationObserver(() => artalk?.setDarkMode(document.body.getAttribute('theme') === 'dark'));
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['theme'] });

  function closePanel() { if (panel.open) panel.close(); }
  panel.addEventListener('close', () => {
    panelRequest++;
    document.body.classList.remove('discussion-panel-open');
    home.append(preview, status, mount);
    if (artalk) {
      try { document.body.appendChild(artalk.ctx.inject('layers').getEl()); } catch { /* Still initializing. */ }
    }
    returnFocus?.focus({ preventScroll: true });
  });
  panel.querySelector('.discussion-close').addEventListener('click', closePanel);
  panel.addEventListener('click', event => {
    const bounds = panel.getBoundingClientRect();
    if (event.target === panel && (event.clientX < bounds.left || event.clientY < bounds.top || event.clientX > bounds.right || event.clientY > bounds.bottom)) closePanel();
  });
  function markdownQuote(text) { return text.replace(/[\\`*_{}\[\]<>]/g, '\\$&').split('\n').map(line => `> ${line}`).join('\n'); }
  async function openPanel(context) {
    const request = ++panelRequest;
    returnFocus = document.activeElement;
    toolbar.hidden = true;
    panel.insertBefore(preview, panel.querySelector('.discussion-panel-body'));
    panel.querySelector('.discussion-panel-body').append(status, mount);
    if (!panel.open) {
      document.body.classList.add('discussion-panel-open');
      panel.showModal();
      panel.scrollTop = 0;
    }
    if (context) {
      preview.hidden = false;
      preview.querySelector('blockquote').textContent = context.text;
      quoted = context;
    }
    try {
      const instance = await ensureLoaded();
      const editor = instance.ctx.inject('editor');
      // Closing a panel during loading must not move focus or edit the draft.
      if (!panel.open || request !== panelRequest) return;
      panel.appendChild(instance.ctx.inject('layers').getEl());
      editor.focus();
    } catch { message('The discussion could not be loaded.'); }
  }
  section.querySelector('.discussion-open').addEventListener('click', () => openPanel());
  panel.querySelector('.discussion-context').addEventListener('click', () => { closePanel(); showContext(quoted); });
  preview.querySelector('.discussion-remove-quote').addEventListener('click', () => { quoted = null; preview.hidden = true; });
  toolbar.querySelector('[data-quote-reply]').addEventListener('click', () => { const current = selection; window.getSelection()?.removeAllRanges(); openPanel(current); });
  toolbar.querySelector('[data-quote-copy]').addEventListener('click', async () => {
    if (!selection) return;
    const url = new URL(contextURL(selection), location.href).href;
    try { await navigator.clipboard.writeText(url); message('Link to this passage copied.'); }
    catch { history.replaceState(null, '', contextURL(selection)); message('Copy the passage link from your address bar.'); }
    toolbar.hidden = true;
  });
  toolbar.addEventListener('pointerdown', event => event.preventDefault());
  let selectionTimer;
  function updateSelection() {
    if (panel.open) return;
    const selected = window.getSelection();
    if (!selected?.rangeCount || selected.isCollapsed || !content.contains(selected.anchorNode) || !content.contains(selected.focusNode)) { toolbar.hidden = true; return; }
    const range = selected.getRangeAt(0);
    const ancestor = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    const block = ancestor.closest('p, li, h2, h3, h4, blockquote');
    const text = selected.toString().trim();
    if (!blocks.includes(block) || !text || text.length > 1200 || !block.textContent.includes(text)) { toolbar.hidden = true; return; }
    selection = { id: block.id, text, heading: headingFor(block) };
    toolbar.hidden = false;
    const rect = range.getBoundingClientRect();
    const width = toolbar.offsetWidth, height = toolbar.offsetHeight;
    toolbar.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2))}px`;
    toolbar.style.top = `${Math.max(8, Math.min(window.innerHeight - height - 8, rect.top > height + 12 ? rect.top - height - 8 : rect.bottom + 8))}px`;
  }
  document.addEventListener('selectionchange', () => { clearTimeout(selectionTimer); selectionTimer = setTimeout(updateSelection, 160); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') toolbar.hidden = true; });
  window.addEventListener('scroll', () => { toolbar.hidden = true; }, { passive: true });
  window.addEventListener('resize', () => { toolbar.hidden = true; });
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); ensureLoaded().catch(() => {}); } }, { rootMargin: '300px' });
    observer.observe(section);
  } else ensureLoaded().catch(() => {});
})();
