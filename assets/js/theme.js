"use strict";

class Util {
  forEach(elements, handler) {
    elements = elements || [];

    for (let i = 0; i < elements.length; i++) handler(elements[i]);
  }

  getScrollTop() {
    return document.documentElement && document.documentElement.scrollTop || document.body.scrollTop;
  }

  isMobile() {
    return window.matchMedia('only screen and (max-width: 680px)').matches;
  }

  isTocStatic() {
    return window.matchMedia('only screen and (max-width: 960px)').matches;
  }

  animateCSS(element, animation, reserved, callback) {
    if (!Array.isArray(animation)) animation = [animation];
    element.classList.add('animate__animated', ...animation);

    const handler = () => {
      element.classList.remove('animate__animated', ...animation);
      element.removeEventListener('animationend', handler);
      if (typeof callback === 'function') callback();
    };

    if (!reserved) element.addEventListener('animationend', handler, false);
  }

}

class Theme {
  constructor() {
    this.config = window.config;
    this.data = this.config.data;
    this.isDark = document.body.getAttribute('theme') === 'dark';
    this.util = new Util();
    this.newScrollTop = this.util.getScrollTop();
    this.oldScrollTop = this.newScrollTop;
    this.scrollEventSet = new Set();
    this.resizeEventSet = new Set();
    this.switchThemeEventSet = new Set();
    this.clickMaskEventSet = new Set();
    if (window.objectFitImages) objectFitImages();
  }

  initRaw() {
    this.util.forEach(document.querySelectorAll('[data-raw]'), $raw => {
      $raw.innerHTML = this.data[$raw.id];
    });
  }

  initSVGIcon() {
    this.util.forEach(document.querySelectorAll('[data-svg-src]'), $icon => {
      fetch($icon.getAttribute('data-svg-src')).then(response => response.text()).then(svg => {
        const $temp = document.createElement('div');
        $temp.insertAdjacentHTML('afterbegin', svg);
        const $svg = $temp.firstChild;
        $svg.setAttribute('data-svg-src', $icon.getAttribute('data-svg-src'));
        $svg.classList.add('icon');
        const $titleElements = $svg.getElementsByTagName('title');
        if ($titleElements.length) $svg.removeChild($titleElements[0]);
        $icon.parentElement.replaceChild($svg, $icon);
      }).catch(err => {
        console.error(err);
      });
    });
  }

  initTwemoji() {
    if (this.config.twemoji) twemoji.parse(document.body);
  }

  initMenuMobile() {
    const $menuToggleMobile = document.getElementById('menu-toggle-mobile');
    const $menuMobile = document.getElementById('menu-mobile');
    $menuToggleMobile.addEventListener('click', () => {
      document.body.classList.toggle('blur');
      const isOpen = $menuMobile.classList.toggle('active');
      $menuToggleMobile.classList.toggle('active', isOpen);
      $menuToggleMobile.setAttribute('aria-expanded', String(isOpen));
    }, false);

    this._menuMobileOnClickMask = this._menuMobileOnClickMask || (() => {
      $menuToggleMobile.classList.remove('active');
      $menuToggleMobile.setAttribute('aria-expanded', 'false');
      $menuMobile.classList.remove('active');
    });

    this.clickMaskEventSet.add(this._menuMobileOnClickMask);
  }

  initSwitchTheme() {
    this.util.forEach(document.getElementsByClassName('theme-switch'), $themeSwitch => {
      $themeSwitch.addEventListener('click', () => {
        if (document.body.getAttribute('theme') === 'dark') document.body.setAttribute('theme', 'light');else document.body.setAttribute('theme', 'dark');
        this.isDark = !this.isDark;
        window.localStorage && localStorage.setItem('theme', this.isDark ? 'dark' : 'light');

        for (let event of this.switchThemeEventSet) event();
      }, false);
    });
  }

  loadScriptOnce(id, src) {
    const existing = document.getElementById(id);
    if (existing && existing.dataset.loaded === 'true') return Promise.resolve();

    return new Promise((resolve, reject) => {
      const script = existing || document.createElement('script');
      const onLoad = () => {
        script.dataset.loaded = 'true';
        resolve();
      };
      const onError = () => {
        script.remove();
        reject(new Error(`Unable to load ${src}`));
      };
      script.addEventListener('load', onLoad, {
        once: true
      });
      script.addEventListener('error', onError, {
        once: true
      });
      if (!existing) {
        script.id = id;
        script.src = src;
        script.async = true;
        document.head.appendChild(script);
      }
    });
  }

  loadSearchDependencies(searchConfig) {
    if (this._searchDependenciesPromise) return this._searchDependenciesPromise;
    const dependencies = [{
      id: 'search-autocomplete',
      src: searchConfig.autocompleteURL
    }, {
      id: 'search-lunr',
      src: searchConfig.lunrURL
    }, {
      id: 'search-lunr-stemmer',
      src: searchConfig.lunrStemmerURL
    }, {
      id: 'search-lunr-language',
      src: searchConfig.lunrLanguageURL
    }, {
      id: 'search-lunr-segmentit',
      src: searchConfig.lunrSegmentitURL
    }].filter(dependency => dependency.src);
    this._searchDependenciesPromise = dependencies.reduce((promise, dependency) => promise.then(() => this.loadScriptOnce(dependency.id, dependency.src)), Promise.resolve()).catch(error => {
      this._searchDependenciesPromise = null;
      throw error;
    });
    return this._searchDependenciesPromise;
  }

  initSearch() {
    const searchConfig = this.config.search;
    const isMobile = this.util.isMobile();
    if (!searchConfig || isMobile && this._searchMobileOnce || !isMobile && this._searchDesktopOnce) return;
    const maxResultLength = searchConfig.maxResultLength ? searchConfig.maxResultLength : 10;
    const snippetLength = searchConfig.snippetLength ? searchConfig.snippetLength : 50;
    const highlightTag = searchConfig.highlightTag ? searchConfig.highlightTag : 'em';
    const suffix = isMobile ? 'mobile' : 'desktop';
    const $header = document.getElementById(`header-${suffix}`);
    const $searchInput = document.getElementById(`search-input-${suffix}`);
    const $searchToggle = document.getElementById(`search-toggle-${suffix}`);
    const $searchLoading = document.getElementById(`search-loading-${suffix}`);
    const $searchClear = document.getElementById(`search-clear-${suffix}`);

    if (isMobile) {
      this._searchMobileOnce = true;
      $searchInput.addEventListener('focus', () => {
        document.body.classList.add('blur');
        $header.classList.add('open');
        ensureAutosearch();
      }, false);
      document.getElementById('search-cancel-mobile').addEventListener('click', () => {
        $header.classList.remove('open');
        document.body.classList.remove('blur');
        const $menuToggleMobile = document.getElementById('menu-toggle-mobile');
        $menuToggleMobile.classList.remove('active');
        $menuToggleMobile.setAttribute('aria-expanded', 'false');
        document.getElementById('menu-mobile').classList.remove('active');
        $searchLoading.style.display = 'none';
        $searchClear.style.display = 'none';
        this._searchMobile && this._searchMobile.autocomplete.setVal('');
      }, false);
      $searchClear.addEventListener('click', () => {
        $searchClear.style.display = 'none';
        this._searchMobile && this._searchMobile.autocomplete.setVal('');
      }, false);

      this._searchMobileOnClickMask = this._searchMobileOnClickMask || (() => {
        $header.classList.remove('open');
        $searchLoading.style.display = 'none';
        $searchClear.style.display = 'none';
        this._searchMobile && this._searchMobile.autocomplete.setVal('');
      });

      this.clickMaskEventSet.add(this._searchMobileOnClickMask);
    } else {
      this._searchDesktopOnce = true;
      $searchToggle.addEventListener('click', () => {
        document.body.classList.add('blur');
        $header.classList.add('open');
        $searchInput.focus();
        ensureAutosearch();
      }, false);
      $searchClear.addEventListener('click', () => {
        $searchClear.style.display = 'none';
        this._searchDesktop && this._searchDesktop.autocomplete.setVal('');
      }, false);

      this._searchDesktopOnClickMask = this._searchDesktopOnClickMask || (() => {
        $header.classList.remove('open');
        $searchLoading.style.display = 'none';
        $searchClear.style.display = 'none';
        this._searchDesktop && this._searchDesktop.autocomplete.setVal('');
      });

      this.clickMaskEventSet.add(this._searchDesktopOnClickMask);
    }

    $searchInput.addEventListener('input', () => {
      if ($searchInput.value === '') $searchClear.style.display = 'none';else $searchClear.style.display = 'inline';
      ensureAutosearch();
    }, false);

    const initAutosearch = () => {
      const autosearch = autocomplete(`#search-input-${suffix}`, {
        hint: false,
        autoselect: true,
        dropdownMenuContainer: `#search-dropdown-${suffix}`,
        clearOnSelected: true,
        cssClasses: {
          noPrefix: true
        },
        debug: true
      }, {
        name: 'search',
        source: (query, callback) => {
          $searchLoading.style.display = 'inline';
          $searchClear.style.display = 'none';

          const finish = results => {
            $searchLoading.style.display = 'none';
            $searchClear.style.display = 'inline';
            callback(results);
          };

          if (searchConfig.type === 'lunr') {
            const search = () => {
              try {
                if (lunr.queryHandler) query = lunr.queryHandler(query);
                const results = {};

                this._index.search(query).forEach(_ref => {
                  let {
                    ref,
                    matchData: {
                      metadata
                    }
                  } = _ref;
                  const matchData = this._indexData[ref];
                  let {
                    uri,
                    title,
                    content: context
                  } = matchData;
                  if (results[uri]) return;
                  let position = 0;
                  Object.values(metadata).forEach(_ref2 => {
                    let {
                      content
                    } = _ref2;

                    if (content) {
                      const matchPosition = content.position[0][0];
                      if (matchPosition < position || position === 0) position = matchPosition;
                    }
                  });
                  position -= snippetLength / 5;

                  if (position > 0) {
                    position += context.substr(position, 20).lastIndexOf(' ') + 1;
                    context = '...' + context.substr(position, snippetLength);
                  } else {
                    context = context.substr(0, snippetLength);
                  }

                  Object.keys(metadata).forEach(key => {
                    title = title.replace(new RegExp(`(${key})`, 'gi'), `<${highlightTag}>$1</${highlightTag}>`);
                    context = context.replace(new RegExp(`(${key})`, 'gi'), `<${highlightTag}>$1</${highlightTag}>`);
                  });
                  results[uri] = {
                    'uri': uri,
                    'title': title,
                    'date': matchData.date,
                    'context': context
                  };
                });

                return Object.values(results).slice(0, maxResultLength);
              } catch (error) {
                console.error(error);
                return [];
              }
            };

            if (!this._index) {
              fetch(searchConfig.lunrIndexURL).then(response => response.json()).then(data => {
                const indexData = {};
                this._index = lunr(function () {
                  if (searchConfig.lunrLanguageCode) {
                    const language = lunr[searchConfig.lunrLanguageCode];
                    this.use(language);
                    // lunr-languages' Chinese plugin predates searchPipeline.
                    // Keep query processing aligned with its index pipeline so
                    // Latin words are not English-stemmed against unstemmed keys.
                    if (searchConfig.lunrLanguageCode === 'zh' && this.searchPipeline) {
                      this.searchPipeline.reset();
                      this.searchPipeline.add(lunr.zh.trimmer, lunr.zh.stopWordFilter, lunr.zh.stemmer);
                    }
                  }
                  this.ref('objectID');
                  this.field('title', {
                    boost: 50
                  });
                  this.field('tags', {
                    boost: 20
                  });
                  this.field('categories', {
                    boost: 20
                  });
                  this.field('content', {
                    boost: 10
                  });
                  this.metadataWhitelist = ['position'];
                  data.forEach(record => {
                    indexData[record.objectID] = record;
                    this.add(record);
                  });
                });
                this._indexData = indexData;
                finish(search());
              }).catch(err => {
                console.error(err);
                finish([]);
              });
            } else finish(search());
          } else if (searchConfig.type === 'algolia') {
            this._algoliaIndex = this._algoliaIndex || algoliasearch(searchConfig.algoliaAppID, searchConfig.algoliaSearchKey).initIndex(searchConfig.algoliaIndex);

            this._algoliaIndex.search(query, {
              offset: 0,
              length: maxResultLength * 8,
              attributesToHighlight: ['title'],
              attributesToSnippet: [`content:${snippetLength}`],
              highlightPreTag: `<${highlightTag}>`,
              highlightPostTag: `</${highlightTag}>`
            }).then(_ref3 => {
              let {
                hits
              } = _ref3;
              const results = {};
              hits.forEach(_ref4 => {
                let {
                  uri,
                  date,
                  _highlightResult: {
                    title
                  },
                  _snippetResult: {
                    content
                  }
                } = _ref4;
                if (results[uri] && results[uri].context.length > content.value) return;
                results[uri] = {
                  uri: uri,
                  title: title.value,
                  date: date,
                  context: content.value
                };
              });
              finish(Object.values(results).slice(0, maxResultLength));
            }).catch(err => {
              console.error(err);
              finish([]);
            });
          }
        },
        templates: {
          suggestion: _ref5 => {
            let {
              title,
              date,
              context
            } = _ref5;
            return `<div><span class="suggestion-title">${title}</span><span class="suggestion-date">${date}</span></div><div class="suggestion-context">${context}</div>`;
          },
          empty: _ref6 => {
            let {
              query
            } = _ref6;
            return `<div class="search-empty">${searchConfig.noResultsFound}: <span class="search-query">"${query}"</span></div>`;
          },
          footer: _ref7 => {
            let {} = _ref7;
            const {
              searchType,
              icon,
              href
            } = searchConfig.type === 'algolia' ? {
              searchType: 'algolia',
              icon: '<i class="fab fa-algolia fa-fw" aria-hidden="true"></i>',
              href: 'https://www.algolia.com/'
            } : {
              searchType: 'Lunr.js',
              icon: '',
              href: 'https://lunrjs.com/'
            };
            return `<div class="search-footer">Search by <a href="${href}" rel="noopener noreffer" target="_blank">${icon} ${searchType}</a></div>`;
          }
        }
      });
      autosearch.on('autocomplete:selected', (_event, suggestion, _dataset, _context) => {
        window.location.assign(suggestion.uri);
      });
      if (isMobile) this._searchMobile = autosearch;else this._searchDesktop = autosearch;
    };
    const searchInstanceKey = isMobile ? '_searchMobile' : '_searchDesktop';
    const setupPromiseKey = isMobile ? '_searchMobileSetupPromise' : '_searchDesktopSetupPromise';
    const ensureAutosearch = () => {
      if (this[searchInstanceKey]) return Promise.resolve(this[searchInstanceKey]);
      if (this[setupPromiseKey]) return this[setupPromiseKey];
      $searchLoading.style.display = 'inline';
      this[setupPromiseKey] = this.loadSearchDependencies(searchConfig).then(() => {
        const pendingQuery = $searchInput.value;
        if (!this[searchInstanceKey]) {
          // Autocomplete snapshots the input's current value during setup and
          // ignores an immediate same-value input event. Initialize against an
          // empty value, then restore text typed while dependencies were loading.
          $searchInput.value = '';
          initAutosearch();
          $searchInput.value = pendingQuery;
        }
        this[setupPromiseKey] = null;
        if ($searchInput.value) $searchInput.dispatchEvent(new Event('input', {
          bubbles: true
        }));else $searchLoading.style.display = 'none';
        return this[searchInstanceKey];
      }).catch(error => {
        this[setupPromiseKey] = null;
        $searchLoading.style.display = 'none';
        console.error(error);
      });
      return this[setupPromiseKey];
    };
  }

  initDetails() {
    this.util.forEach(document.getElementsByClassName('details'), $details => {
      const $summary = $details.getElementsByClassName('details-summary')[0];
      $summary.addEventListener('click', () => {
        $details.classList.toggle('open');
      }, false);
    });
  }

  initLightGallery() {
    if (this.config.lightgallery) lightGallery(document.getElementById('content'), {
      plugins: [lgThumbnail, lgZoom],
      selector: '.lightgallery',
      speed: 400,
      hideBarsDelay: 2000,
      allowMediaOverlap: true,
      exThumbImage: 'data-thumbnail',
      toggleThumb: true,
      thumbWidth: 80,
      thumbHeight: '60px',
      actualSize: false,
      showZoomInOutIcons: true
    });
  }

  initHighlight() {
    this.util.forEach(document.querySelectorAll('.highlight > pre.chroma'), $preChroma => {
      const $chroma = document.createElement('div');
      $chroma.className = $preChroma.className;
      const $table = document.createElement('table');
      $chroma.appendChild($table);
      const $tbody = document.createElement('tbody');
      $table.appendChild($tbody);
      const $tr = document.createElement('tr');
      $tbody.appendChild($tr);
      const $td = document.createElement('td');
      $tr.appendChild($td);
      $preChroma.parentElement.replaceChild($chroma, $preChroma);
      $td.appendChild($preChroma);
    });
    this.util.forEach(document.querySelectorAll('.highlight > .chroma'), $chroma => {
      const $codeElements = $chroma.querySelectorAll('pre.chroma > code');

      if ($codeElements.length) {
        const $code = $codeElements[$codeElements.length - 1];
        const $header = document.createElement('div');
        $header.className = 'code-header ' + $code.className.toLowerCase();
        const $title = document.createElement('span');
        $title.classList.add('code-title');
        $title.insertAdjacentHTML('afterbegin', '<i class="arrow fas fa-chevron-right fa-fw" aria-hidden="true"></i>');
        $title.addEventListener('click', () => {
          $chroma.classList.toggle('open');
        }, false);
        $header.appendChild($title);
        const $ellipses = document.createElement('span');
        $ellipses.insertAdjacentHTML('afterbegin', '<i class="fas fa-ellipsis-h fa-fw" aria-hidden="true"></i>');
        $ellipses.classList.add('ellipses');
        $ellipses.addEventListener('click', () => {
          $chroma.classList.add('open');
        }, false);
        $header.appendChild($ellipses);
        const $copy = document.createElement('span');
        $copy.insertAdjacentHTML('afterbegin', '<i class="far fa-copy fa-fw" aria-hidden="true"></i>');
        $copy.classList.add('copy');
        const code = $code.innerText;
        if (this.config.code.maxShownLines < 0 || code.split('\n').length < this.config.code.maxShownLines + 2) $chroma.classList.add('open');

        if (this.config.code.copyTitle) {
          $copy.setAttribute('data-clipboard-text', code);
          $copy.title = this.config.code.copyTitle;
          const clipboard = new ClipboardJS($copy);
          clipboard.on('success', _e => {
            this.util.animateCSS($code, 'animate__flash');
          });
          $header.appendChild($copy);
        }

        $chroma.insertBefore($header, $chroma.firstChild);
      }
    });
  }

  initTable() {
    this.util.forEach(document.querySelectorAll('.content table'), $table => {
      const $wrapper = document.createElement('div');
      $wrapper.className = 'table-wrapper';
      $table.parentElement.replaceChild($wrapper, $table);
      $wrapper.appendChild($table);
    });
  }

  initHeaderLink() {
    for (let num = 1; num <= 6; num++) {
      this.util.forEach(document.querySelectorAll('.single .content > h' + num), $header => {
        $header.classList.add('headerLink');
        $header.insertAdjacentHTML('afterbegin', `<a href="#${$header.id}" class="header-mark"></a>`);
      });
    }
  }

  initToc() {
    const $tocCore = document.getElementById('TableOfContents');
    if ($tocCore === null) return;

    if (document.getElementById('toc-static').getAttribute('data-kept') || this.util.isTocStatic()) {
      const $tocContentStatic = document.getElementById('toc-content-static');

      if ($tocCore.parentElement !== $tocContentStatic) {
        $tocCore.parentElement.removeChild($tocCore);
        $tocContentStatic.appendChild($tocCore);
      }

      if (this._tocOnScroll) this.scrollEventSet.delete(this._tocOnScroll);
    } else {
      const $tocContentAuto = document.getElementById('toc-content-auto');

      if ($tocCore.parentElement !== $tocContentAuto) {
        $tocCore.parentElement.removeChild($tocCore);
        $tocContentAuto.appendChild($tocCore);
      }

      const $toc = document.getElementById('toc-auto');
      const $page = document.getElementsByClassName('page')[0];
      const rect = $page.getBoundingClientRect();
      $toc.style.left = `${rect.left + rect.width + 20}px`;
      $toc.style.maxWidth = `${$page.getBoundingClientRect().left - 20}px`;
      $toc.style.visibility = 'visible';
      const $tocLinkElements = $tocCore.querySelectorAll('a:first-child');
      const $tocLiElements = $tocCore.getElementsByTagName('li');
      const $headerLinkElements = document.getElementsByClassName('headerLink');
      const headerIsFixed = document.body.getAttribute('data-header-desktop') !== 'normal';
      const headerHeight = document.getElementById('header-desktop').offsetHeight;
      const TOP_SPACING = 20 + (headerIsFixed ? headerHeight : 0);
      const minTocTop = $toc.offsetTop;
      const minScrollTop = minTocTop - TOP_SPACING + (headerIsFixed ? 0 : headerHeight);

      this._tocOnScroll = this._tocOnScroll || (() => {
        const footerTop = document.getElementById('post-footer').offsetTop;
        const maxTocTop = footerTop - $toc.getBoundingClientRect().height;
        const maxScrollTop = maxTocTop - TOP_SPACING + (headerIsFixed ? 0 : headerHeight);

        if (this.newScrollTop < minScrollTop) {
          $toc.style.position = 'absolute';
          $toc.style.top = `${minTocTop}px`;
        } else if (this.newScrollTop > maxScrollTop) {
          $toc.style.position = 'absolute';
          $toc.style.top = `${maxTocTop}px`;
        } else {
          $toc.style.position = 'fixed';
          $toc.style.top = `${TOP_SPACING}px`;
        }

        this.util.forEach($tocLinkElements, $tocLink => {
          $tocLink.classList.remove('active');
        });
        this.util.forEach($tocLiElements, $tocLi => {
          $tocLi.classList.remove('has-active');
        });
        const INDEX_SPACING = 20 + (headerIsFixed ? headerHeight : 0);
        let activeTocIndex = $headerLinkElements.length - 1;

        for (let i = 0; i < $headerLinkElements.length - 1; i++) {
          const thisTop = $headerLinkElements[i].getBoundingClientRect().top;
          const nextTop = $headerLinkElements[i + 1].getBoundingClientRect().top;

          if (i == 0 && thisTop > INDEX_SPACING || thisTop <= INDEX_SPACING && nextTop > INDEX_SPACING) {
            activeTocIndex = i;
            break;
          }
        }

        if (activeTocIndex !== -1) {
          $tocLinkElements[activeTocIndex].classList.add('active');
          let $parent = $tocLinkElements[activeTocIndex].parentElement;

          while ($parent !== $tocCore) {
            $parent.classList.add('has-active');
            $parent = $parent.parentElement.parentElement;
          }
        }
      });

      this._tocOnScroll();

      this.scrollEventSet.add(this._tocOnScroll);
    }
  }

  initMath() {
    if (this.config.math) renderMathInElement(document.body, this.config.math);
  }

  initMermaid() {
    this._mermaidOnSwitchTheme = this._mermaidOnSwitchTheme || (() => {
      const elements = Array.from(document.getElementsByClassName('mermaid'));
      if (!elements.length) return;
      const revision = this._mermaidRevision = (this._mermaidRevision || 0) + 1;
      // Serialize renders: Mermaid shares configuration and a render queue.
      // A rapid theme switch must never commit an older theme's SVG.
      this._mermaidRenderQueue = (this._mermaidRenderQueue || Promise.resolve()).then(async () => {
        await document.fonts.ready;
        if (revision !== this._mermaidRevision) return;
        const dark = this.isDark;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'base',
          look: 'classic',
          securityLevel: 'loose',
          fontFamily: '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
          themeVariables: {
            darkMode: dark,
            fontSize: '16px',
            primaryColor: dark ? '#273344' : '#f1f5f9',
            primaryTextColor: dark ? '#e2e8f0' : '#334155',
            primaryBorderColor: dark ? '#64748b' : '#94a3b8',
            lineColor: dark ? '#94a3b8' : '#64748b',
            secondaryColor: dark ? '#253a3b' : '#f0fdfa',
            tertiaryColor: dark ? '#292d3e' : '#f8fafc',
            clusterBkg: dark ? '#202733' : '#f8fafc',
            clusterBorder: dark ? '#475569' : '#cbd5e1',
            edgeLabelBackground: dark ? '#202733' : '#ffffff',
            actorBkg: dark ? '#273344' : '#eff6ff',
            actorBorder: dark ? '#64748b' : '#93b4d5',
            actorTextColor: dark ? '#e2e8f0' : '#334155',
            signalColor: dark ? '#cbd5e1' : '#475569',
            signalTextColor: dark ? '#e2e8f0' : '#334155',
            labelBoxBkgColor: dark ? '#273344' : '#f1f5f9',
            labelBoxBorderColor: dark ? '#64748b' : '#cbd5e1',
            labelTextColor: dark ? '#e2e8f0' : '#334155',
            loopTextColor: dark ? '#e2e8f0' : '#334155'
          },
          flowchart: { curve: 'linear', nodeSpacing: 28, rankSpacing: 36, padding: 18, wrappingWidth: 360 },
          sequence: { mirrorActors: false, actorMargin: 32, messageMargin: 28, wrap: true }
        });
        for (const element of elements) {
          if (revision !== this._mermaidRevision) return;
          try {
            const { svg, bindFunctions } = await mermaid.render(
              `svg-${element.id}-${revision}`, this.data[element.id]
            );
            if (revision !== this._mermaidRevision || !element.isConnected) return;
            element.innerHTML = svg;
            element.dataset.renderRevision = revision;
            const graphic = element.querySelector('svg');
            if (graphic) {
              // Retain legible text on narrow screens; scroll within the diagram.
              const width = graphic.viewBox.baseVal.width;
              graphic.style.width = `${width}px`;
              graphic.style.minWidth = `${Math.min(width, 960)}px`;
              graphic.style.maxWidth = '100%';
              graphic.style.height = 'auto';
            }
            bindFunctions?.(element);
          } catch (error) {
            if (revision !== this._mermaidRevision) return;
            const source = document.createElement('pre');
            source.textContent = this.data[element.id];
            element.replaceChildren(source);
            console.error('Mermaid diagram failed:', element.id, error);
          }
        }
      }).catch(error => console.error('Mermaid initialization failed:', error));
    });
    this.switchThemeEventSet.add(this._mermaidOnSwitchTheme);
    this._mermaidOnSwitchTheme();
  }

  initEcharts() {
    if (this.config.echarts) {
      echarts.registerTheme('light', this.config.echarts.lightTheme);
      echarts.registerTheme('dark', this.config.echarts.darkTheme);

      this._echartsOnSwitchTheme = this._echartsOnSwitchTheme || (() => {
        this._echartsArr = this._echartsArr || [];

        for (let i = 0; i < this._echartsArr.length; i++) {
          this._echartsArr[i].dispose();
        }

        this._echartsArr = [];
        this.util.forEach(document.getElementsByClassName('echarts'), $echarts => {
          const chart = echarts.init($echarts, this.isDark ? 'dark' : 'light', {
            renderer: 'svg'
          });
          chart.setOption(JSON.parse(this.data[$echarts.id]));

          this._echartsArr.push(chart);
        });
      });

      this.switchThemeEventSet.add(this._echartsOnSwitchTheme);

      this._echartsOnSwitchTheme();

      this._echartsOnResize = this._echartsOnResize || (() => {
        for (let i = 0; i < this._echartsArr.length; i++) {
          this._echartsArr[i].resize();
        }
      });

      this.resizeEventSet.add(this._echartsOnResize);
    }
  }

  initMapbox() {
    if (this.config.mapbox) {
      mapboxgl.accessToken = this.config.mapbox.accessToken;
      mapboxgl.setRTLTextPlugin(this.config.mapbox.RTLTextPlugin);
      this._mapboxArr = this._mapboxArr || [];
      this.util.forEach(document.getElementsByClassName('mapbox'), $mapbox => {
        const {
          lng,
          lat,
          zoom,
          lightStyle,
          darkStyle,
          marked,
          navigation,
          geolocate,
          scale,
          fullscreen
        } = this.data[$mapbox.id];
        const mapbox = new mapboxgl.Map({
          container: $mapbox,
          center: [lng, lat],
          zoom: zoom,
          minZoom: .2,
          style: this.isDark ? darkStyle : lightStyle,
          attributionControl: false
        });

        if (marked) {
          new mapboxgl.Marker().setLngLat([lng, lat]).addTo(mapbox);
        }

        if (navigation) {
          mapbox.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
        }

        if (geolocate) {
          mapbox.addControl(new mapboxgl.GeolocateControl({
            positionOptions: {
              enableHighAccuracy: true
            },
            showUserLocation: true,
            trackUserLocation: true
          }), 'bottom-right');
        }

        if (scale) {
          mapbox.addControl(new mapboxgl.ScaleControl());
        }

        if (fullscreen) {
          mapbox.addControl(new mapboxgl.FullscreenControl());
        }

        mapbox.addControl(new MapboxLanguage());

        this._mapboxArr.push(mapbox);
      });

      this._mapboxOnSwitchTheme = this._mapboxOnSwitchTheme || (() => {
        this.util.forEach(this._mapboxArr, mapbox => {
          const $mapbox = mapbox.getContainer();
          const {
            lightStyle,
            darkStyle
          } = this.data[$mapbox.id];
          mapbox.setStyle(this.isDark ? darkStyle : lightStyle);
          mapbox.addControl(new MapboxLanguage());
        });
      });

      this.switchThemeEventSet.add(this._mapboxOnSwitchTheme);
    }
  }

  initTypeit() {
    if (this.config.typeit) {
      const typeitConfig = this.config.typeit;
      const speed = typeitConfig.speed ? typeitConfig.speed : 100;
      const cursorSpeed = typeitConfig.cursorSpeed ? typeitConfig.cursorSpeed : 1000;
      const cursorChar = typeitConfig.cursorChar ? typeitConfig.cursorChar : '|';
      Object.values(typeitConfig.data).forEach(group => {
        const typeone = i => {
          const id = group[i];
          const instance = new TypeIt(`#${id}`, {
            strings: this.data[id],
            speed: speed,
            lifeLike: true,
            cursorSpeed: cursorSpeed,
            cursorChar: cursorChar,
            waitUntilVisible: true,
            afterComplete: () => {
              if (i === group.length - 1) {
                if (typeitConfig.duration >= 0) window.setTimeout(() => {
                  instance.destroy();
                }, typeitConfig.duration);
                return;
              }

              instance.destroy();
              typeone(i + 1);
            }
          }).go();
        };

        typeone(0);
      });
    }
  }

  initComment() {
    if (this.config.comment) {
      if (this.config.comment.gitalk) {
        this.config.comment.gitalk.body = decodeURI(window.location.href);
        const gitalk = new Gitalk(this.config.comment.gitalk);
        gitalk.render('gitalk');
      }

      if (this.config.comment.valine) new Valine(this.config.comment.valine);

      if (this.config.comment.utterances) {
        const utterancesConfig = this.config.comment.utterances;
        const script = document.createElement('script');
        script.src = 'https://utteranc.es/client.js';
        script.type = 'text/javascript';
        script.setAttribute('repo', utterancesConfig.repo);
        script.setAttribute('issue-term', utterancesConfig.issueTerm);
        if (utterancesConfig.label) script.setAttribute('label', utterancesConfig.label);
        script.setAttribute('theme', this.isDark ? utterancesConfig.darkTheme : utterancesConfig.lightTheme);
        script.crossOrigin = 'anonymous';
        script.async = true;
        document.getElementById('utterances').appendChild(script);

        this._utterancesOnSwitchTheme = this._utterancesOnSwitchTheme || (() => {
          const message = {
            type: 'set-theme',
            theme: this.isDark ? utterancesConfig.darkTheme : utterancesConfig.lightTheme
          };
          const iframe = document.querySelector('.utterances-frame');
          iframe.contentWindow.postMessage(message, 'https://utteranc.es');
        });

        this.switchThemeEventSet.add(this._utterancesOnSwitchTheme);
      }

      if (this.config.comment.giscus) {
        const giscusConfig = this.config.comment.giscus;
        const giscusScript = document.createElement('script');
        giscusScript.src = 'https://giscus.app/client.js';
        giscusScript.type = 'text/javascript';
        giscusScript.setAttribute('data-repo', giscusConfig.repo);
        giscusScript.setAttribute('data-repo-id', giscusConfig.repoId);
        giscusScript.setAttribute('data-category', giscusConfig.category);
        giscusScript.setAttribute('data-category-id', giscusConfig.categoryId);
        giscusScript.setAttribute('data-lang', giscusConfig.lang);
        giscusScript.setAttribute('data-mapping', giscusConfig.mapping);
        giscusScript.setAttribute('data-reactions-enabled', giscusConfig.reactionsEnabled);
        giscusScript.setAttribute('data-emit-metadata', giscusConfig.emitMetadata);
        giscusScript.setAttribute('data-input-position', giscusConfig.inputPosition);
        if (giscusConfig.lazyLoading) giscusScript.setAttribute('data-loading', 'lazy');
        giscusScript.setAttribute('data-theme', this.isDark ? giscusConfig.darkTheme : giscusConfig.lightTheme);
        giscusScript.crossOrigin = 'anonymous';
        giscusScript.async = true;
        document.getElementById('giscus').appendChild(giscusScript);

        this._giscusOnSwitchTheme = this._giscusOnSwitchTheme || (() => {
          const message = {
            setConfig: {
              theme: this.isDark ? giscusConfig.darkTheme : giscusConfig.lightTheme,
              reactionsEnabled: false
            }
          };
          const iframe = document.querySelector('iframe.giscus-frame');
          if (!iframe) return;
          iframe.contentWindow.postMessage({
            giscus: message
          }, 'https://giscus.app');
        });

        this.switchThemeEventSet.add(this._giscusOnSwitchTheme);
      }
    }
  }

  initCookieconsent() {
    if (this.config.cookieconsent) cookieconsent.initialise(this.config.cookieconsent);
  }

  onScroll() {
    const $headers = [];
    if (document.body.getAttribute('data-header-desktop') === 'auto') $headers.push(document.getElementById('header-desktop'));
    if (document.body.getAttribute('data-header-mobile') === 'auto') $headers.push(document.getElementById('header-mobile'));

    if (document.getElementById('comments')) {
      const $viewComments = document.getElementById('view-comments');
      $viewComments.href = `#comments`;
      $viewComments.style.display = 'block';
    }

    const $fixedButtons = document.getElementById('fixed-buttons');
    const ACCURACY = 20,
          MINIMUM = 100;
    window.addEventListener('scroll', () => {
      this.newScrollTop = this.util.getScrollTop();
      const scroll = this.newScrollTop - this.oldScrollTop;
      const isMobile = this.util.isMobile();
      this.util.forEach($headers, $header => {
        if (scroll > ACCURACY) {
          $header.classList.remove('animate__fadeInDown');
          this.util.animateCSS($header, ['animate__fadeOutUp', 'animate__faster'], true);
        } else if (scroll < -ACCURACY) {
          $header.classList.remove('animate__fadeOutUp');
          this.util.animateCSS($header, ['animate__fadeInDown', 'animate__faster'], true);
        }
      });

      if (this.newScrollTop > MINIMUM) {
        if (isMobile && scroll > ACCURACY) {
          $fixedButtons.classList.remove('animate__fadeIn');
          this.util.animateCSS($fixedButtons, ['animate__fadeOut', 'animate__faster'], true);
        } else if (!isMobile || scroll < -ACCURACY) {
          $fixedButtons.style.display = 'block';
          $fixedButtons.classList.remove('animate__fadeOut');
          this.util.animateCSS($fixedButtons, ['animate__fadeIn', 'animate__faster'], true);
        }
      } else {
        if (!isMobile) {
          $fixedButtons.classList.remove('animate__fadeIn');
          this.util.animateCSS($fixedButtons, ['animate__fadeOut', 'animate__faster'], true);
        }

        $fixedButtons.style.display = 'none';
      }

      for (let event of this.scrollEventSet) event();

      this.oldScrollTop = this.newScrollTop;
    }, false);
  }

  onResize() {
    window.addEventListener('resize', () => {
      if (!this._resizeTimeout) {
        this._resizeTimeout = window.setTimeout(() => {
          this._resizeTimeout = null;

          for (let event of this.resizeEventSet) event();

          this.initToc();
          this.initSearch();
        }, 100);
      }
    }, false);
  }

  onClickMask() {
    document.getElementById('mask').addEventListener('click', () => {
      for (let event of this.clickMaskEventSet) event();

      document.body.classList.remove('blur');
    }, false);
  }

  init() {
    try {
      this.initRaw();
      this.initSVGIcon();
      this.initTwemoji();
      this.initMenuMobile();
      this.initSwitchTheme();
      this.initSearch();
      this.initDetails();
      this.initLightGallery();
      this.initHighlight();
      this.initTable();
      this.initHeaderLink();
      this.initMath();
      this.initMermaid();
      this.initEcharts();
      this.initTypeit();
      this.initMapbox();
      this.initCookieconsent();
    } catch (err) {
      console.error(err);
    }

    window.setTimeout(() => {
      this.initToc();
      this.initComment();
      this.onScroll();
      this.onResize();
      this.onClickMask();
    }, 100);
  }

}

const themeInit = () => {
  const theme = new Theme();
  theme.init();
};

if (document.readyState !== 'loading') {
  themeInit();
} else {
  document.addEventListener('DOMContentLoaded', themeInit, false);
}
