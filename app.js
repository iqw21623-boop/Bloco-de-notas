(function () {
  'use strict';

  /* ============================= Storage ============================= */
  var NOTES_KEY = 'bn:notes';
  var SETTINGS_KEY = 'bn:settings';

  var DEFAULT_SETTINGS = {
    theme: 'system',
    confirmDelete: true,
    autosave: true,
    defaultSort: 'updated'
  };

  function loadNotes() {
    try {
      var raw = localStorage.getItem(NOTES_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      console.error('Falha ao carregar anotações', e);
      return [];
    }
  }

  function saveNotes() {
    try {
      localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
      return true;
    } catch (e) {
      console.error('Falha ao salvar anotações', e);
      showToast('Não foi possível salvar. Espaço de armazenamento cheio?');
      return false;
    }
  }

  function loadSettings() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      var obj = raw ? JSON.parse(raw) : {};
      return Object.assign({}, DEFAULT_SETTINGS, obj);
    } catch (e) {
      return Object.assign({}, DEFAULT_SETTINGS);
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      console.error('Falha ao salvar configurações', e);
    }
  }

  /* ============================= State ============================= */
  var notes = loadNotes();
  var settings = loadSettings();
  var ui = {
    filter: 'all',        // all | favorites | pinned | archived
    sort: settings.defaultSort,
    query: '',
    editingId: null,
    isNewNote: false
  };
  var pendingModalResolve = null;

  /* ============================= Helpers ============================= */
  function uid() {
    return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function nowIso() { return new Date().toISOString(); }

  function stripTags(html) {
    var d = document.createElement('div');
    d.innerHTML = html || '';
    return (d.textContent || d.innerText || '').replace(/\s+/g, ' ').trim();
  }

  function fold(str) {
    return (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  var dtFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });
  var tFormatter = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
  function formatDateTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    var today = new Date();
    var sameDay = d.toDateString() === today.toDateString();
    var datePart = sameDay ? 'hoje' : dtFormatter.format(d).replace('.', '');
    return datePart + ' · ' + tFormatter.format(d);
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  /* ============================= Toast ============================= */
  var toastTimer = null;
  function showToast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  /* ============================= Modal ============================= */
  function openModal(opts) {
    // opts: { title, text, actions: [{label, cls, value}] }
    return new Promise(function (resolve) {
      $('#modal-title').textContent = opts.title || '';
      $('#modal-text').textContent = opts.text || '';
      var actionsEl = $('#modal-actions');
      actionsEl.innerHTML = '';
      (opts.actions || []).forEach(function (a) {
        var btn = document.createElement('button');
        btn.className = a.cls || 'btn-quiet';
        btn.textContent = a.label;
        btn.addEventListener('click', function () {
          closeModal();
          resolve(a.value);
        });
        actionsEl.appendChild(btn);
      });
      $('#modal-scrim').classList.add('open');
      pendingModalResolve = resolve;
    });
  }
  function closeModal() {
    $('#modal-scrim').classList.remove('open');
    pendingModalResolve = null;
  }
  $('#modal-scrim').addEventListener('click', function (e) {
    if (e.target === $('#modal-scrim')) { closeModal(); }
  });

  function confirmDialog(title, text, confirmLabel, danger) {
    return openModal({
      title: title,
      text: text,
      actions: [
        { label: 'Cancelar', cls: 'btn-quiet', value: false },
        { label: confirmLabel, cls: danger ? 'btn-danger' : 'btn-primary', value: true }
      ]
    });
  }

  /* ============================= Theme ============================= */
  var mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function applyTheme() {
    var mode = settings.theme;
    var dark = mode === 'dark' || (mode === 'system' && mql && mql.matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }
  if (mql) {
    var onSchemeChange = function () { if (settings.theme === 'system') applyTheme(); };
    if (mql.addEventListener) mql.addEventListener('change', onSchemeChange);
    else if (mql.addListener) mql.addListener(onSchemeChange);
  }

  /* ============================= Navigation ============================= */
  var VIEWS = ['view-list', 'view-editor', 'view-settings', 'view-trash'];

  function showView(id) {
    VIEWS.forEach(function (v) {
      $('#' + v).classList.toggle('active', v === id);
    });
    window.scrollTo(0, 0);
    updateCtxBar();
  }

  function go(state, push) {
    // state: {view, filter}
    if (push !== false) {
      history.pushState(state, '', '#' + state.view + (state.filter ? '/' + state.filter : ''));
    }
    render(state);
  }

  window.addEventListener('popstate', function (e) {
    var state = e.state || { view: 'view-list', filter: 'all' };
    render(state);
  });

  function updateDrawerActive(state) {
    var activeFilter = null;
    if (state.view === 'view-list') activeFilter = state.filter || 'all';
    else if (state.view === 'view-trash') activeFilter = 'trash';
    else if (state.view === 'view-settings') activeFilter = 'settings';
    $all('.drawer .nav-item').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-filter') === activeFilter);
    });
  }

  function render(state) {
    closeDrawer();
    updateDrawerActive(state);
    if (state.view === 'view-list') {
      ui.filter = state.filter || 'all';
      showView('view-list');
      renderList();
    } else if (state.view === 'view-trash') {
      showView('view-trash');
      renderTrash();
    } else if (state.view === 'view-settings') {
      showView('view-settings');
      renderSettings();
    } else if (state.view === 'view-editor') {
      showView('view-editor');
      loadEditor(state.noteId);
    }
  }

  /* ============================= Drawer ============================= */
  function openDrawer() {
    $('#drawer').classList.add('open');
    $('#scrim').classList.add('open');
  }
  function closeDrawer() {
    $('#drawer').classList.remove('open');
    $('#scrim').classList.remove('open');
  }
  $('#btn-menu').addEventListener('click', openDrawer);
  $('#scrim').addEventListener('click', closeDrawer);

  $all('.drawer .nav-item').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var f = btn.getAttribute('data-filter');
      closeDrawer();
      if (f === 'trash') go({ view: 'view-trash' });
      else if (f === 'settings') go({ view: 'view-settings' });
      else go({ view: 'view-list', filter: f });
    });
  });

  $('#btn-settings-top').addEventListener('click', function () { go({ view: 'view-settings' }); });

  /* ============================= List rendering ============================= */
  var FILTER_TITLES = {
    all: 'Bloco de Notas',
    favorites: 'Favoritas',
    pinned: 'Fixadas',
    archived: 'Arquivadas'
  };
  var EMPTY_MESSAGES = {
    all: 'Você ainda não tem anotações. Toque em + para começar.',
    favorites: 'Nenhuma anotação favoritada ainda.',
    pinned: 'Nenhuma anotação fixada ainda.',
    archived: 'Nenhuma anotação arquivada.'
  };

  function scopedNotes(filter) {
    return notes.filter(function (n) {
      if (n.deleted) return false;
      if (filter === 'archived') return !!n.archived;
      if (n.archived) return false;
      if (filter === 'favorites') return !!n.favorite;
      if (filter === 'pinned') return !!n.pinned;
      return true;
    });
  }

  function applySearch(list, query) {
    if (!query) return list;
    var q = fold(query.trim());
    if (!q) return list;
    return list.filter(function (n) {
      var title = fold(n.title || '');
      var body = fold(stripTags(n.content || ''));
      return title.indexOf(q) !== -1 || body.indexOf(q) !== -1;
    });
  }

  function applySort(list, sortKey) {
    var arr = list.slice();
    if (sortKey === 'alpha') {
      arr.sort(function (a, b) {
        var ta = a.title || 'Sem título', tb = b.title || 'Sem título';
        return ta.localeCompare(tb, 'pt-BR', { sensitivity: 'base' });
      });
    } else if (sortKey === 'created') {
      arr.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
    } else {
      arr.sort(function (a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); });
    }
    return arr;
  }

  function bubblePinned(list) {
    var pinned = list.filter(function (n) { return n.pinned; });
    var rest = list.filter(function (n) { return !n.pinned; });
    return pinned.concat(rest);
  }

  function renderList() {
    $('#list-title').textContent = FILTER_TITLES[ui.filter] || 'Bloco de Notas';
    $('#sort-select').value = ui.sort;
    $('#search-input').value = ui.query;

    var list = scopedNotes(ui.filter);
    var totalInScope = list.length;
    list = applySearch(list, ui.query);
    list = applySort(list, ui.sort);
    if (ui.filter === 'all' || ui.filter === 'favorites') list = bubblePinned(list);

    var countLabel = totalInScope + (totalInScope === 1 ? ' anotação' : ' anotações');
    $('#list-count').textContent = countLabel;

    var container = $('#note-list');
    container.innerHTML = '';
    var emptyEl = $('#empty-state');

    if (list.length === 0) {
      emptyEl.style.display = '';
      $('#empty-text').textContent = (ui.query && totalInScope > 0)
        ? 'Nenhuma anotação encontrada.'
        : (totalInScope === 0 ? EMPTY_MESSAGES[ui.filter] : 'Nenhuma anotação encontrada.');
      $('#empty-glyph').textContent = (ui.query) ? '🔍' : '✎';
      container.style.display = 'none';
      return;
    }
    emptyEl.style.display = 'none';
    container.style.display = '';

    list.forEach(function (n) {
      container.appendChild(buildNoteRow(n));
    });
  }

  function buildNoteRow(n) {
    var row = document.createElement('div');
    row.className = 'note-row' + (n.pinned ? ' pinned' : '');
    row.setAttribute('data-id', n.id);
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');

    var star = n.favorite
      ? '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.63 22 9.24 16.8 13.97 18.36 21 12 17.3 5.64 21 7.2 13.97 2 9.24 8.91 8.63"/></svg>'
      : '';
    var title = n.title && n.title.trim() ? n.title : 'Sem título';
    var preview = stripTags(n.content || '') || 'Sem conteúdo';

    row.innerHTML =
      '<div class="note-main">' +
        '<div class="note-title">' + star + '<span>' + escapeHtml(title) + '</span></div>' +
        '<div class="note-preview">' + escapeHtml(preview) + '</div>' +
        '<div class="note-date">' + formatDateTime(n.updatedAt) + '</div>' +
      '</div>';

    if (ui.filter === 'archived') {
      var actions = document.createElement('div');
      actions.className = 'note-actions';
      var restoreBtn = document.createElement('button');
      restoreBtn.className = 'chip-btn';
      restoreBtn.textContent = 'Restaurar';
      restoreBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        n.archived = false;
        n.updatedAt = nowIso();
        saveNotes();
        renderList();
        showToast('Anotação restaurada.');
      });
      actions.appendChild(restoreBtn);
      row.appendChild(actions);
    }

    row.addEventListener('click', function (ev) {
      if (ev.target.closest && ev.target.closest('.note-actions')) return;
      go({ view: 'view-editor', noteId: n.id });
    });
    row.addEventListener('keydown', function (ev) {
      if ((ev.key === 'Enter' || ev.key === ' ') && !(ev.target.closest && ev.target.closest('.note-actions'))) {
        ev.preventDefault();
        go({ view: 'view-editor', noteId: n.id });
      }
    });

    return row;
  }

  $('#search-input').addEventListener('input', function (e) {
    ui.query = e.target.value;
    renderList();
  });
  $('#sort-select').addEventListener('change', function (e) {
    ui.sort = e.target.value;
    renderList();
  });
  $('#btn-new').addEventListener('click', function () {
    go({ view: 'view-editor', noteId: null });
  });

  /* ============================= Trash rendering ============================= */
  function renderTrash() {
    var list = notes.filter(function (n) { return n.deleted; });
    list.sort(function (a, b) { return new Date(b.deletedAt || b.updatedAt) - new Date(a.deletedAt || a.updatedAt); });

    $('#trash-count').textContent = list.length + (list.length === 1 ? ' item' : ' itens');
    var container = $('#trash-list');
    container.innerHTML = '';
    var emptyEl = $('#trash-empty');

    if (list.length === 0) {
      emptyEl.style.display = '';
      container.style.display = 'none';
      return;
    }
    emptyEl.style.display = 'none';
    container.style.display = '';

    list.forEach(function (n) {
      var row = document.createElement('div');
      row.className = 'note-row';
      var title = n.title && n.title.trim() ? n.title : 'Sem título';
      var preview = stripTags(n.content || '') || 'Sem conteúdo';
      row.innerHTML =
        '<div class="note-main">' +
          '<div class="note-title"><span>' + escapeHtml(title) + '</span></div>' +
          '<div class="note-preview">' + escapeHtml(preview) + '</div>' +
          '<div class="note-date">Excluída em ' + formatDateTime(n.deletedAt || n.updatedAt) + '</div>' +
        '</div>';
      var actions = document.createElement('div');
      actions.className = 'note-actions';
      actions.style.flexDirection = 'column';
      actions.style.gap = '6px';

      var restoreBtn = document.createElement('button');
      restoreBtn.className = 'chip-btn';
      restoreBtn.textContent = 'Restaurar';
      restoreBtn.addEventListener('click', function () {
        n.deleted = false;
        n.deletedAt = null;
        n.updatedAt = nowIso();
        saveNotes();
        renderTrash();
        showToast('Anotação restaurada.');
      });

      var delBtn = document.createElement('button');
      delBtn.className = 'chip-btn danger';
      delBtn.textContent = 'Excluir';
      delBtn.addEventListener('click', function () {
        confirmDialog(
          'Excluir definitivamente?',
          'Essa anotação será apagada para sempre e não poderá ser recuperada.',
          'Excluir', true
        ).then(function (ok) {
          if (!ok) return;
          notes = notes.filter(function (x) { return x.id !== n.id; });
          saveNotes();
          renderTrash();
          showToast('Anotação excluída definitivamente.');
        });
      });

      actions.appendChild(restoreBtn);
      actions.appendChild(delBtn);
      row.appendChild(actions);
      container.appendChild(row);
    });
  }

  $('#btn-trash-back').addEventListener('click', function () { history.back(); });

  /* ============================= Editor ============================= */
  var editorDirty = false;
  var editorAutosaveTimer = null;

  function loadEditor(id) {
    editorDirty = false;
    clearTimeout(editorAutosaveTimer);
    var note;
    if (id) {
      note = notes.find(function (n) { return n.id === id; });
      ui.isNewNote = false;
    }
    if (!note) {
      var ts = nowIso();
      note = {
        id: uid(), title: '', content: '', createdAt: ts, updatedAt: ts,
        favorite: false, pinned: false, archived: false, deleted: false, deletedAt: null
      };
      ui.isNewNote = true;
    }
    ui.editingId = note.id;
    ui._draft = note; // working reference; persisted only on save

    $('#note-title').value = note.title || '';
    var body = $('#note-body');
    body.innerHTML = sanitizeHtml(note.content);
    updateEditorMeta(note);
    updateEditorToggleIcons(note);
    $('#btn-editor-delete').style.display = ui.isNewNote ? 'none' : '';
    $('#note-title').focus();
  }

  function updateEditorMeta(note) {
    if (ui.isNewNote) {
      $('#editor-meta').textContent = '';
    } else {
      $('#editor-meta').textContent = 'Criada ' + formatDateTime(note.createdAt) + ' · editada ' + formatDateTime(note.updatedAt);
    }
  }

  function updateEditorToggleIcons(note) {
    $('#btn-editor-favorite').classList.toggle('on', !!note.favorite);
    $('#btn-editor-pin').classList.toggle('on', !!note.pinned);
  }

  function currentNote() {
    return notes.find(function (n) { return n.id === ui.editingId; }) || ui._draft;
  }

  function hasContent(note) {
    return !!(note.title && note.title.trim()) || !!stripTags(note.content).trim();
  }

  function commitEditorFields(note) {
    note.title = $('#note-title').value;
    note.content = $('#note-body').innerHTML;
  }

  function persistEditor(showMsg) {
    var note = currentNote();
    commitEditorFields(note);
    note.updatedAt = nowIso();
    if (!notes.some(function (n) { return n.id === note.id; })) {
      notes.unshift(note);
    }
    ui.isNewNote = false;
    saveNotes();
    editorDirty = false;
    updateEditorMeta(note);
    $('#btn-editor-delete').style.display = '';
    if (showMsg) showToast('Salvo.');
  }

  function markDirty() {
    editorDirty = true;
    if (settings.autosave) {
      clearTimeout(editorAutosaveTimer);
      editorAutosaveTimer = setTimeout(function () { persistEditor(false); }, 700);
    }
  }

  $('#note-title').addEventListener('input', markDirty);
  $('#note-body').addEventListener('input', markDirty);

  $('#btn-editor-save').addEventListener('click', function () {
    var note = currentNote();
    commitEditorFields(note);
    if (!hasContent(note)) { showToast('Nada para salvar.'); return; }
    persistEditor(true);
    history.back();
  });

  $('#btn-editor-back').addEventListener('click', function () {
    var note = currentNote();
    commitEditorFields(note);
    var exists = notes.some(function (n) { return n.id === note.id; });

    if (!hasContent(note)) {
      // Nothing worth keeping — discard silently if it was never saved.
      history.back();
      return;
    }
    if (!exists) {
      persistEditor(false);
    } else if (editorDirty) {
      persistEditor(false);
    }
    history.back();
  });

  function persistIfWorthKeeping(note) {
    commitEditorFields(note);
    if (hasContent(note) || notes.some(function (n) { return n.id === note.id; })) {
      persistEditor(false);
    }
  }

  $('#btn-editor-favorite').addEventListener('click', function () {
    var note = currentNote();
    note.favorite = !note.favorite;
    updateEditorToggleIcons(note);
    persistIfWorthKeeping(note);
    showToast(note.favorite ? 'Adicionada aos favoritos.' : 'Removida dos favoritos.');
  });

  $('#btn-editor-pin').addEventListener('click', function () {
    var note = currentNote();
    note.pinned = !note.pinned;
    updateEditorToggleIcons(note);
    persistIfWorthKeeping(note);
    showToast(note.pinned ? 'Anotação fixada.' : 'Anotação desafixada.');
  });

  $('#btn-editor-share').addEventListener('click', function () {
    var note = currentNote();
    commitEditorFields(note);
    var title = note.title && note.title.trim() ? note.title : 'Sem título';
    var text = convertHtml(note.content, false);
    if (navigator.share) {
      navigator.share({ title: title, text: text }).catch(function () {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(title + '\n\n' + text).then(function () {
        showToast('Copiado para a área de transferência.');
      }).catch(function () {
        showToast('Não foi possível compartilhar.');
      });
    } else {
      showToast('Compartilhamento não é suportado neste dispositivo.');
    }
  });

  $('#btn-editor-more').addEventListener('click', function () {
    var note = currentNote();
    commitEditorFields(note);
    var acts = [
      { label: 'Fechar', cls: 'btn-quiet', value: 'close' },
      { label: 'Exportar', cls: 'btn-quiet', value: 'export' }
    ];
    if (!ui.isNewNote) {
      acts.push(note.archived
        ? { label: 'Desarquivar', cls: 'btn-primary', value: 'unarchive' }
        : { label: 'Arquivar', cls: 'btn-primary', value: 'archive' });
    }
    openModal({
      title: note.archived ? 'Anotação arquivada' : 'Mais opções',
      text: ui.isNewNote ? 'Exporte esta anotação em outro formato.'
        : (note.archived ? 'Esta anotação está arquivada.' : 'Arquive para tirá-la da lista principal sem excluí-la, ou exporte em outro formato.'),
      actions: acts
    }).then(function (val) {
      if (val === 'export') {
        exportNoteDialog(note);
      } else if (val === 'archive') {
        note.archived = true; note.updatedAt = nowIso(); saveNotes();
        showToast('Anotação arquivada.');
        history.back();
      } else if (val === 'unarchive') {
        note.archived = false; note.updatedAt = nowIso(); saveNotes();
        showToast('Anotação desarquivada.');
      }
    });
  });

  function doSoftDelete() {
    var note = currentNote();
    note.deleted = true;
    note.deletedAt = nowIso();
    note.updatedAt = nowIso();
    if (!notes.some(function (n) { return n.id === note.id; })) notes.unshift(note);
    saveNotes();
    showToast('Anotação enviada para a lixeira.');
    history.back();
  }

  $('#btn-editor-delete').addEventListener('click', function () {
    if (settings.confirmDelete) {
      confirmDialog('Excluir anotação?', 'Ela será movida para a lixeira e poderá ser restaurada depois.', 'Excluir', true)
        .then(function (ok) { if (ok) doSoftDelete(); });
    } else {
      doSoftDelete();
    }
  });

  /* ---- Sanitização, tabelas, código e exportação ---- */
  var ALLOWED = { B:1, STRONG:1, I:1, EM:1, U:1, H1:1, H2:1, H3:1, UL:1, OL:1, LI:1, A:1, BR:1, P:1, DIV:1, SPAN:1, CODE:1, PRE:1, TABLE:1, THEAD:1, TBODY:1, TR:1, TD:1, TH:1 };

  function sanitizeHtml(html) {
    var doc = new DOMParser().parseFromString('<body>' + (html || '') + '</body>', 'text/html');
    (function clean(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (c) {
        if (c.nodeType === 3) return;
        if (c.nodeType !== 1 || /^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|LINK|META|SVG)$/i.test(c.tagName)) { node.removeChild(c); return; }
        clean(c);
        if (!ALLOWED[c.tagName]) {
          while (c.firstChild) node.insertBefore(c.firstChild, c);
          node.removeChild(c);
          return;
        }
        var href = c.tagName === 'A' ? c.getAttribute('href') : null;
        Array.prototype.slice.call(c.attributes).forEach(function (a) { c.removeAttribute(a.name); });
        if (href && /^(https?:|mailto:|tel:)/i.test(href.trim())) c.setAttribute('href', href.trim());
      });
    })(doc.body);
    return doc.body.innerHTML;
  }

  function inBody(node) { return !!node && $('#note-body').contains(node); }

  function closestIn(node, sel) {
    var body = $('#note-body');
    var el = node && node.nodeType === 3 ? node.parentNode : node;
    while (el && el !== body) {
      if (el.matches && el.matches(sel)) return el;
      el = el.parentNode;
    }
    return null;
  }

  var lastRange = null;
  function restoreSel() {
    var s = window.getSelection();
    if (!s.rangeCount || !inBody(s.anchorNode)) {
      s.removeAllRanges();
      if (lastRange) s.addRange(lastRange);
      else { var r = document.createRange(); r.selectNodeContents($('#note-body')); r.collapse(false); s.addRange(r); }
    }
    return s;
  }

  function placeCaret(el, atEnd) {
    $('#note-body').focus();
    var r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(!atEnd);
    var s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }

  function topBlock(node) {
    var body = $('#note-body');
    if (node === body) return null;
    while (node && node.parentNode !== body) node = node.parentNode;
    return node;
  }

  function insertBlock(el) {
    var body = $('#note-body'), s = restoreSel();
    var blk = topBlock(s.anchorNode);
    if (blk && blk.nodeType === 1 && !blk.textContent.trim() && !blk.querySelector('table,pre')) body.replaceChild(el, blk);
    else if (blk) body.insertBefore(el, blk.nextSibling);
    else body.appendChild(el);
    if (!el.nextSibling) {
      var tail = document.createElement('div');
      tail.appendChild(document.createElement('br'));
      body.appendChild(tail);
    }
  }

  function insertTable() {
    var v = window.prompt('Tamanho da tabela (linhas x colunas)', '3x3');
    var m = v && v.match(/(\d+)\s*[x×*]\s*(\d+)/i);
    if (!m) return;
    var rows = Math.min(Math.max(+m[1], 1), 30), cols = Math.min(Math.max(+m[2], 1), 10);
    var h = '';
    for (var i = 0; i < rows; i++) {
      var tag = i === 0 ? 'th' : 'td';
      h += '<tr>';
      for (var j = 0; j < cols; j++) h += '<' + tag + '><br></' + tag + '>';
      h += '</tr>';
    }
    var t = document.createElement('table');
    t.innerHTML = '<tbody>' + h + '</tbody>';
    insertBlock(t);
    placeCaret(t.rows[0].cells[0]);
  }

  function unwrapPre(pre) {
    var frag = document.createDocumentFragment(), last;
    pre.textContent.split('\n').forEach(function (line) {
      var d = document.createElement('div');
      if (line) d.textContent = line; else d.appendChild(document.createElement('br'));
      frag.appendChild(d);
      last = d;
    });
    pre.parentNode.replaceChild(frag, pre);
    placeCaret(last, true);
  }

  function toggleCodeBlock() {
    var s = restoreSel(), pre = closestIn(s.anchorNode, 'pre');
    if (pre) { unwrapPre(pre); return; }
    var text = s.isCollapsed ? '' : s.toString();
    var el = document.createElement('pre');
    if (text) { el.textContent = text; s.deleteFromDocument(); }
    else el.appendChild(document.createElement('br'));
    insertBlock(el);
    placeCaret(el, true);
  }

  function toggleInlineCode() {
    var s = restoreSel(), c = closestIn(s.anchorNode, 'code');
    if (c && !closestIn(c, 'pre')) {
      var txt = document.createTextNode(c.textContent);
      c.parentNode.replaceChild(txt, c);
      return;
    }
    if (s.isCollapsed) { showToast('Selecione um trecho para virar código.'); return; }
    document.execCommand('insertHTML', false, '<code>' + escapeHtml(s.toString()) + '</code>');
    var cc = closestIn(s.anchorNode, 'code');
    if (cc) {
      var r = document.createRange();
      r.setStartAfter(cc);
      r.collapse(true);
      s.removeAllRanges();
      s.addRange(r);
    }
  }

  function tableOp(op) {
    var cell = closestIn(window.getSelection().anchorNode, 'td,th');
    if (!cell) return;
    var tr = cell.parentNode, table = closestIn(tr, 'table'), ci = cell.cellIndex;
    var rows = Array.prototype.slice.call(table.rows), ri = rows.indexOf(tr);
    function mk(tag) { var c = document.createElement(tag || 'td'); c.appendChild(document.createElement('br')); return c; }
    if (op === 'row+') {
      var nr = document.createElement('tr');
      for (var i = 0; i < tr.cells.length; i++) nr.appendChild(mk());
      tr.parentNode.insertBefore(nr, tr.nextSibling);
      placeCaret(nr.cells[Math.min(ci, nr.cells.length - 1)]);
    } else if (op === 'col+') {
      rows.forEach(function (r) {
        var ref = r.cells[ci];
        r.insertBefore(mk(ref ? ref.tagName.toLowerCase() : 'td'), ref ? ref.nextSibling : null);
      });
      placeCaret(tr.cells[ci + 1] || cell);
    } else if (op === 'row-' && rows.length > 1) {
      var nx = rows[ri + 1] || rows[ri - 1];
      tr.parentNode.removeChild(tr);
      placeCaret(nx.cells[Math.min(ci, nx.cells.length - 1)]);
    } else if (op === 'col-' && tr.cells.length > 1) {
      rows.forEach(function (r) { if (r.cells[ci]) r.removeChild(r.cells[ci]); });
      placeCaret(tr.cells[Math.min(ci, tr.cells.length - 1)]);
    } else {
      var next = table.nextElementSibling || table.previousElementSibling, body = $('#note-body');
      table.parentNode.removeChild(table);
      if (!body.firstChild) {
        next = document.createElement('div');
        next.appendChild(document.createElement('br'));
        body.appendChild(next);
      }
      if (next) placeCaret(next, true);
    }
  }

  function copyText(t) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t);
    return new Promise(function (ok, fail) {
      var ta = document.createElement('textarea');
      ta.value = t;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy') ? ok() : fail(); } catch (e) { fail(); }
      document.body.removeChild(ta);
    });
  }

  var CTX = {
    table: [['row+', '+ Linha'], ['col+', '+ Coluna'], ['row-', '− Linha'], ['col-', '− Coluna'], ['del', 'Apagar tabela']],
    pre: [['copy', 'Copiar código'], ['unpre', 'Virar texto']]
  };

  function updateCtxBar() {
    var bar = $('#ctx-bar'), kind = null;
    if ($('#view-editor').classList.contains('active')) {
      var s = window.getSelection(), n = s.rangeCount ? s.anchorNode : null;
      if (inBody(n)) kind = closestIn(n, 'td,th') ? 'table' : (closestIn(n, 'pre') ? 'pre' : null);
    }
    if (bar.getAttribute('data-kind') === (kind || '')) return;
    bar.setAttribute('data-kind', kind || '');
    bar.style.display = kind ? '' : 'none';
    bar.innerHTML = '';
    (CTX[kind] || []).forEach(function (o) {
      var b = document.createElement('button');
      b.setAttribute('data-op', o[0]);
      b.textContent = o[1];
      if (o[0] === 'del') b.className = 'danger';
      bar.appendChild(b);
    });
  }

  function ctxAction(op) {
    var pre = closestIn(window.getSelection().anchorNode, 'pre');
    if (op === 'copy') {
      if (pre) copyText(pre.textContent).then(function () { showToast('Código copiado.'); }, function () { showToast('Não foi possível copiar.'); });
      return;
    }
    if (op === 'unpre') { if (pre) unwrapPre(pre); }
    else tableOp(op);
    markDirty();
    updateCtxBar();
  }

  document.addEventListener('selectionchange', function () {
    var s = window.getSelection();
    if (s.rangeCount && inBody(s.anchorNode)) lastRange = s.getRangeAt(0).cloneRange();
    updateCtxBar();
  });
  $('#ctx-bar').addEventListener('mousedown', function (e) { e.preventDefault(); });
  $('#ctx-bar').addEventListener('click', function (e) {
    var op = e.target.getAttribute && e.target.getAttribute('data-op');
    if (op) ctxAction(op);
  });

  // Colar sempre como texto puro (sem estilos vindos de outros sites)
  $('#note-body').addEventListener('paste', function (e) {
    e.preventDefault();
    var text = ((e.clipboardData || window.clipboardData).getData('text/plain') || '').replace(/\r\n?/g, '\n');
    if (!text) return;
    if (closestIn(window.getSelection().anchorNode, 'pre')) document.execCommand('insertHTML', false, escapeHtml(text));
    else document.execCommand('insertText', false, text);
  });

  // HTML da nota -> texto puro (md=false) ou Markdown (md=true)
  function convertHtml(html, md) {
    var root = new DOMParser().parseFromString('<body>' + sanitizeHtml(html) + '</body>', 'text/html').body;
    function inl(n) { var s = ''; Array.prototype.forEach.call(n.childNodes, function (c) { s += walk(c); }); return s; }
    function cells(tr) {
      return Array.prototype.map.call(tr.children, function (td) { return inl(td).replace(/\n+/g, ' ').replace(/\|/g, md ? '\\|' : '|').trim(); });
    }
    function walk(n) {
      if (n.nodeType === 3) return n.nodeValue.replace(/\u00a0/g, ' ');
      if (n.nodeType !== 1) return '';
      var t = n.tagName.toLowerCase();
      if (t === 'b' || t === 'strong') return md ? '**' + inl(n) + '**' : inl(n);
      if (t === 'i' || t === 'em') return md ? '*' + inl(n) + '*' : inl(n);
      if (t === 'code') return md ? '`' + n.textContent + '`' : n.textContent;
      if (t === 'a') {
        var h = n.getAttribute('href') || '', tx = inl(n);
        return md ? '[' + tx + '](' + h + ')' : (h && tx !== h ? tx + ' (' + h + ')' : tx);
      }
      if (t === 'br') return '\n';
      if (t === 'h1' || t === 'h2' || t === 'h3') return (md ? '## ' : '') + inl(n) + '\n\n';
      if (t === 'pre') return (md ? '```\n' : '') + n.textContent.replace(/\n$/, '') + (md ? '\n```' : '') + '\n\n';
      if (t === 'ul' || t === 'ol') {
        return Array.prototype.map.call(n.children, function (li, i) {
          return (t === 'ol' ? (i + 1) + '. ' : (md ? '- ' : '• ')) + inl(li).trim();
        }).join('\n') + '\n\n';
      }
      if (t === 'table') {
        var rows = Array.prototype.map.call(n.querySelectorAll('tr'), cells);
        if (!rows.length) return '';
        if (!md) return rows.map(function (r) { return r.join('\t'); }).join('\n') + '\n\n';
        var out = ['| ' + rows[0].join(' | ') + ' |', '|' + rows[0].map(function () { return ' --- |'; }).join('')];
        rows.slice(1).forEach(function (r) { out.push('| ' + r.join(' | ') + ' |'); });
        return out.join('\n') + '\n\n';
      }
      if (t === 'p') return inl(n) + '\n\n';
      if (t === 'div') return inl(n) + '\n';
      return inl(n);
    }
    return inl(root).replace(/\n{3,}/g, '\n\n').trim();
  }

  function downloadFile(name, mime, text) {
    var url = URL.createObjectURL(new Blob([text], { type: mime }));
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function exportNoteDialog(note) {
    var t = note.title && note.title.trim() ? note.title.trim() : 'Sem título';
    var base = fold(t).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'anotacao';
    openModal({
      title: 'Exportar anotação',
      text: 'Escolha o formato do arquivo.',
      actions: [
        { label: 'Cancelar', cls: 'btn-quiet', value: null },
        { label: '.txt', cls: 'btn-quiet', value: 'txt' },
        { label: '.md', cls: 'btn-quiet', value: 'md' },
        { label: '.html', cls: 'btn-quiet', value: 'html' },
        { label: '.json', cls: 'btn-quiet', value: 'json' }
      ]
    }).then(function (f) {
      if (!f) return;
      if (f === 'txt') downloadFile(base + '.txt', 'text/plain;charset=utf-8', t + '\n\n' + convertHtml(note.content, false) + '\n');
      else if (f === 'md') downloadFile(base + '.md', 'text/markdown;charset=utf-8', '# ' + t + '\n\n' + convertHtml(note.content, true) + '\n');
      else if (f === 'html') {
        downloadFile(base + '.html', 'text/html;charset=utf-8',
          '<!DOCTYPE html>\n<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escapeHtml(t) + '</title>' +
          '<style>body{font-family:Georgia,serif;max-width:720px;margin:2rem auto;padding:0 1rem;line-height:1.6}table{border-collapse:collapse}td,th{border:1px solid #999;padding:6px 10px}pre{background:#f1f1f1;padding:12px;overflow:auto;border-radius:6px}code{font-family:monospace}</style></head><body><h1>' +
          escapeHtml(t) + '</h1>\n' + sanitizeHtml(note.content) + '\n</body></html>\n');
      } else {
        downloadFile(base + '.json', 'application/json', JSON.stringify({ app: 'bloco-de-notas', version: 1, exportedAt: nowIso(), notes: [note] }, null, 2));
      }
      showToast('Exportação iniciada.');
    });
  }

  /* ---- Formatting toolbar ---- */
  function applyCommand(cmd) {
    $('#note-body').focus();
    if (cmd === 'bold') document.execCommand('bold');
    else if (cmd === 'italic') document.execCommand('italic');
    else if (cmd === 'underline') document.execCommand('underline');
    else if (cmd === 'ul') document.execCommand('insertUnorderedList');
    else if (cmd === 'ol') document.execCommand('insertOrderedList');
    else if (cmd === 'heading') {
      var block = document.queryCommandValue('formatBlock');
      document.execCommand('formatBlock', false, (block === 'h2' ? 'p' : 'h2'));
    } else if (cmd === 'table') insertTable();
    else if (cmd === 'codeblock') toggleCodeBlock();
    else if (cmd === 'code') toggleInlineCode();
    else if (cmd === 'link') {
      var url = window.prompt('Endereço do link (https://…)');
      if (url) {
        var sel = window.getSelection();
        if (!sel || sel.isCollapsed) document.execCommand('insertText', false, url);
        document.execCommand('createLink', false, url);
      }
    }
    markDirty();
    refreshFormatState();
  }

  function refreshFormatState() {
    try {
      $all('.format-bar button[data-cmd]').forEach(function (btn) {
        var cmd = btn.getAttribute('data-cmd');
        var map = { bold: 'bold', italic: 'italic', underline: 'underline', ul: 'insertUnorderedList', ol: 'insertOrderedList' };
        if (map[cmd]) btn.classList.toggle('on', document.queryCommandState(map[cmd]));
      });
    } catch (e) { /* queryCommandState can throw in some contexts; ignore */ }
  }

  $all('.format-bar button[data-cmd]').forEach(function (btn) {
    var cmd = btn.getAttribute('data-cmd');
    if (cmd === 'delete') return; // handled separately (btn-editor-delete)
    btn.addEventListener('click', function () { applyCommand(cmd); });
  });
  $('#note-body').addEventListener('keyup', refreshFormatState);
  $('#note-body').addEventListener('mouseup', refreshFormatState);

  /* ============================= Settings ============================= */
  function renderSettings() {
    $all('#theme-segmented button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-theme') === settings.theme);
    });
    $('#switch-confirm-delete').classList.toggle('on', settings.confirmDelete);
    $('#switch-autosave').classList.toggle('on', settings.autosave);
    $('#settings-sort').value = settings.defaultSort;

    var archivedCount = notes.filter(function (n) { return n.archived && !n.deleted; }).length;
    var trashCount = notes.filter(function (n) { return n.deleted; }).length;
    $('#archived-count-label').textContent = archivedCount;
    $('#trash-count-label').textContent = trashCount;
  }

  $('#btn-settings-back').addEventListener('click', function () { history.back(); });

  $all('#theme-segmented button').forEach(function (b) {
    b.addEventListener('click', function () {
      settings.theme = b.getAttribute('data-theme');
      saveSettings();
      applyTheme();
      renderSettings();
    });
  });

  $('#switch-confirm-delete').addEventListener('click', function () {
    settings.confirmDelete = !settings.confirmDelete;
    saveSettings();
    renderSettings();
  });
  $('#switch-autosave').addEventListener('click', function () {
    settings.autosave = !settings.autosave;
    saveSettings();
    renderSettings();
  });
  $('#settings-sort').addEventListener('change', function (e) {
    settings.defaultSort = e.target.value;
    ui.sort = e.target.value;
    saveSettings();
  });

  $('#btn-goto-archived').addEventListener('click', function () { go({ view: 'view-list', filter: 'archived' }); });
  $('#btn-goto-trash').addEventListener('click', function () { go({ view: 'view-trash' }); });

  /* ---- Export / Import ---- */
  $('#btn-export').addEventListener('click', function () {
    var payload = { app: 'bloco-de-notas', version: 1, exportedAt: nowIso(), notes: notes };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = 'bloco-de-notas-backup-' + stamp + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    showToast('Exportação iniciada.');
  });

  $('#btn-import').addEventListener('click', function () { $('#import-file').click(); });

  $('#import-file').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var incoming;
      try {
        var parsed = JSON.parse(reader.result);
        incoming = Array.isArray(parsed) ? parsed : parsed.notes;
        if (!Array.isArray(incoming)) throw new Error('formato inválido');
      } catch (err) {
        showToast('Arquivo inválido. Não foi possível importar.');
        e.target.value = '';
        return;
      }

      var existingIds = {};
      notes.forEach(function (n) { existingIds[n.id] = true; });
      var collisions = incoming.filter(function (n) { return n && n.id && existingIds[n.id]; }).length;
      var fresh = incoming.filter(function (n) { return n && n.id && !existingIds[n.id]; });

      function finishImport(overwrite) {
        fresh.forEach(function (n) { notes.push(sanitizeImportedNote(n)); });
        if (overwrite) {
          incoming.forEach(function (n) {
            if (n && n.id && existingIds[n.id]) {
              var idx = notes.findIndex(function (x) { return x.id === n.id; });
              if (idx !== -1) notes[idx] = sanitizeImportedNote(n);
            }
          });
        }
        saveNotes();
        renderSettings();
        if (ui.filter) renderList();
        showToast('Importação concluída: ' + (fresh.length + (overwrite ? collisions : 0)) + ' anotação(ões).');
      }

      if (collisions > 0) {
        openModal({
          title: 'Anotações já existem',
          text: collisions + ' anotação(ões) do arquivo já existem neste dispositivo. Deseja substituí-las pelas versões importadas?',
          actions: [
            { label: 'Manter atuais', cls: 'btn-quiet', value: 'keep' },
            { label: 'Substituir', cls: 'btn-danger', value: 'overwrite' }
          ]
        }).then(function (choice) { finishImport(choice === 'overwrite'); });
      } else {
        finishImport(false);
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  });

  function sanitizeImportedNote(n) {
    var ts = nowIso();
    return {
      id: n.id || uid(),
      title: typeof n.title === 'string' ? n.title : '',
      content: typeof n.content === 'string' ? sanitizeHtml(n.content) : '',
      createdAt: n.createdAt || ts,
      updatedAt: n.updatedAt || ts,
      favorite: !!n.favorite,
      pinned: !!n.pinned,
      archived: !!n.archived,
      deleted: !!n.deleted,
      deletedAt: n.deletedAt || null
    };
  }

  /* ============================= Service worker ============================= */
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* offline-first still works without it */ });
    });
  }

  /* ============================= Boot ============================= */
  applyTheme();
  if (!history.state) {
    history.replaceState({ view: 'view-list', filter: 'all' }, '');
  }
  render(history.state || { view: 'view-list', filter: 'all' });

})();
