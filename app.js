/* ================= 诗海 Shihai · 应用逻辑 =================
 * 纯前端离线：数据来自 data-tang.js / data-song.js / data-mao.js / data-extra.js
 * 约定：CSS 类名 sc- 前缀；收藏存 localStorage 键 sc_fav_v1
 * 兼容：ES5 写法 + 字符串拼接，避免老内核（MIUI 等）不支持的语法
 */
var SC_VERSION = 'v1.0.0-multi';

(function () {
  'use strict';

  /* ---------- 数据汇总 ---------- */
  var TANG = window.SHICI_TANG || [];
  var SONG = window.SHICI_SONG || [];
  var MAO = window.SHICI_MAO || [];
  var EXTRA = window.SHICI_EXTRA || [];
  var ALL = [];
  var BY_ID = {};

  function pushPoem(p, kind, dynasty) {
    p.kind = kind; p.dyn = dynasty;
    ALL.push(p); BY_ID[p.id] = p;
  }
  var i;
  for (i = 0; i < TANG.length; i++) pushPoem(TANG[i], 'tang', '唐');
  for (i = 0; i < SONG.length; i++) pushPoem(SONG[i], 'song', '宋');
  for (i = 0; i < MAO.length; i++) pushPoem(MAO[i], 'mao', '现代');
  for (i = 0; i < EXTRA.length; i++) pushPoem(EXTRA[i], EXTRA[i].kind || 'tang', EXTRA[i].dyn || '');

  // 分类显示名（面包屑、统计等共用）
  var KIND_NAME = { tang: '唐诗', song: '宋词', mao: '毛主席诗词' };

  /* ---------- 收藏（localStorage） ---------- */
  var FAV_KEY = 'sc_fav_v1';
  function loadFav() {
    try { return JSON.parse(localStorage.getItem(FAV_KEY)) || []; } catch (e) { return []; }
  }
  function saveFav(list) {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(list)); } catch (e) {}
  }
  function isFav(id) { return loadFav().indexOf(id) !== -1; }
  function toggleFav(id) {
    var list = loadFav(), pos = list.indexOf(id);
    if (pos === -1) list.push(id); else list.splice(pos, 1);
    saveFav(list);
    updateCatCounts();
    return pos === -1;
  }

  /* ---------- 工具 ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  var toastTimer = null;
  function toast(msg) {
    var t = $('sc-toast');
    t.textContent = msg;
    t.classList.remove('sc-hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('sc-hidden'); }, 1800);
  }
  // 复制：优先异步 Clipboard API，失败退回 textarea+execCommand（老内核兼容）
  function copyText(text, okMsg) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      var done = false;
      try { done = document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      toast(done ? okMsg : '复制失败，请长按手动复制');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(okMsg); }, fallback);
    } else fallback();
  }

  /* ---------- 视图切换 ---------- */
  var views = ['sc-view-home', 'sc-view-list', 'sc-view-read', 'sc-view-authors', 'sc-view-cipai'];
  function showView(id) {
    for (var v = 0; v < views.length; v++) {
      document.getElementById(views[v]).classList.toggle('sc-active', views[v] === id);
    }
    var tabView = id === 'sc-view-home' ? 'sc-view-home' : (id === 'sc-view-list' ? listTabKey() : '');
    var tabs = document.querySelectorAll('.sc-tabbar button');
    for (var t = 0; t < tabs.length; t++) {
      var btn = tabs[t];
      var on = (btn.getAttribute('data-view') === tabView) ||
        (btn.getAttribute('data-view-list') && 'sc-view-list' === id && btn.getAttribute('data-view-list') === listTabKey());
      btn.classList.toggle('sc-on', !!on);
    }
    window.scrollTo(0, 0);
  }
  function listTabKey() {
    if (!listCtx) return '';
    if (listCtx.type === 'tang' || listCtx.type === 'author' || listCtx.type === 'search') return listCtx.type === 'tang' ? 'tang' : '';
    if (listCtx.type === 'song' || listCtx.type === 'cipai') return 'song';
    if (listCtx.type === 'mao') return 'mao';
    if (listCtx.type === 'fav') return 'fav';
    return '';
  }

  /* ---------- 列表上下文 ---------- */
  var BATCH = 40;
  var listCtx = null;   // {type, title, items, shown, authorFilter}
  var readCtx = null;   // {items, index}

  function openList(type, title, items, extra) {
    listCtx = { type: type, title: title, items: items, shown: 0, authorFilter: '' };
    if (extra && extra.authorFilter) listCtx.authorFilter = extra.authorFilter;
    $('sc-list-title').textContent = title;
    $('sc-list-count').textContent = items.length + ' 首';
    $('sc-poem-list').innerHTML = '';
    $('sc-list-empty').classList.toggle('sc-hidden', items.length > 0);
    renderFilterRow();
    loadBatch();
    showView('sc-view-list');
  }

  function setListByType(type) {
    if (type === 'tang') openList('tang', '唐诗', TANG);
    else if (type === 'song') openList('song', '宋词', SONG);
    else if (type === 'mao') openList('mao', '毛主席诗词', MAO);
    else if (type === 'fav') {
      var ids = loadFav(), items = [];
      for (var k = 0; k < ids.length; k++) if (BY_ID[ids[k]]) items.push(BY_ID[ids[k]]);
      openList('fav', '我的收藏', items);
    }
  }

  function loadBatch() {
    var ul = $('sc-poem-list'), n = listCtx.items, start = listCtx.shown;
    var end = Math.min(start + BATCH, n.length);
    var html = '';
    for (var k = start; k < end; k++) {
      var p = n[k];
      // 词牌不重复显示：标题形如"词牌·题目"时已含词牌名
      var meta = p.a + ' · ' + (p.dyn || '') +
        (p.p && (p.t || '').indexOf(p.p) === -1 ? ' · ' + p.p : '');
      html += '<li class="sc-poem-item" data-id="' + p.id + '">' +
        '<div class="sc-poem-t">' + esc(p.t) + (isFav(p.id) ? '<span class="sc-poem-favdot">♥</span>' : '') + '</div>' +
        '<div class="sc-poem-meta">' + esc(meta) + '</div>' +
        '<div class="sc-poem-prev">' + esc((p.c[0] || '') + ' ' + (p.c[1] || '')) + '</div>' +
        '</li>';
    }
    ul.insertAdjacentHTML('beforeend', html);
    listCtx.shown = end;
    $('sc-load-more').classList.toggle('sc-hidden', end >= n.length);
  }

  /* ---------- 筛选行（唐诗/宋词列表：按热门作者快筛） ---------- */
  function topAuthors(items, limit) {
    var cnt = {}, arr = [];
    for (var k = 0; k < items.length; k++) {
      var a = items[k].a; cnt[a] = (cnt[a] || 0) + 1;
    }
    for (var name in cnt) if (cnt.hasOwnProperty(name)) arr.push([name, cnt[name]]);
    arr.sort(function (x, y) { return y[1] - x[1]; });
    return arr.slice(0, limit);
  }

  function renderFilterRow() {
    var row = $('sc-filter-row');
    row.innerHTML = '';
    if (listCtx.type !== 'tang' && listCtx.type !== 'song') return;
    var srcAll = listCtx.type === 'tang' ? TANG : SONG;
    var tops = topAuthors(srcAll, 10);
    var mk = function (label, author, on) {
      var b = document.createElement('button');
      b.className = 'sc-chip' + (on ? ' sc-on' : '');
      b.textContent = label;
      b.onclick = function () {
        var items = author ? filterByAuthor(srcAll, author) : srcAll;
        openList(listCtx.type, KIND_NAME[listCtx.type], items, { authorFilter: author || '' });
      };
      row.appendChild(b);
    };
    mk('全部', '', !listCtx.authorFilter);
    for (var k = 0; k < tops.length; k++) {
      mk(tops[k][0] + '(' + tops[k][1] + ')', tops[k][0], listCtx.authorFilter === tops[k][0]);
    }
  }
  function filterByAuthor(src, author) {
    var out = [];
    for (var k = 0; k < src.length; k++) if (src[k].a === author) out.push(src[k]);
    return out;
  }

  /* ---------- 搜索 ---------- */
  function doSearch(q) {
    q = (q || '').trim();
    if (!q) { toast('请输入搜索关键词'); return; }
    var items = [];
    for (var k = 0; k < ALL.length; k++) {
      var p = ALL[k];
      if (p.t.indexOf(q) !== -1 || p.a.indexOf(q) !== -1 || (p.p && p.p.indexOf(q) !== -1)) { items.push(p); continue; }
      for (var c = 0; c < p.c.length; c++) {
        if (p.c[c].indexOf(q) !== -1) { items.push(p); break; }
      }
      if (items.length >= 300) break; // 结果上限，防止极端查询过慢
    }
    openList('search', '搜索：' + q + '（' + items.length + '）', items);
  }

  /* ---------- 阅读页 ---------- */
  function openRead(items, index) {
    readCtx = { items: items, index: index };
    renderRead();
    showView('sc-view-read');
  }
  function openReadById(id, items) {
    var p = BY_ID[id];
    if (!p) return;
    var list = items || ALL, idx = -1;
    for (var k = 0; k < list.length; k++) if (list[k].id === id) { idx = k; break; }
    if (idx === -1) { list = [p]; idx = 0; }
    openRead(list, idx);
  }
  function renderRead() {
    var p = readCtx.items[readCtx.index];
    $('sc-read-crumb').textContent = KIND_NAME[p.kind] || (p.dyn ? p.dyn + '诗' : '诗词');
    $('sc-read-title').textContent = p.t || p.p || '无题';
    $('sc-read-meta').innerHTML = '<b>' + esc(p.a) + '</b> · ' + esc(p.dyn || '') +
      (p.p && (p.t || '').indexOf(p.p) === -1 ? ' · 词牌《' + esc(p.p) + '》' : '');
    var html = '';
    for (var k = 0; k < p.c.length; k++) {
      html += '<p>' + esc(p.c[k]) + '</p>';
    }
    $('sc-read-lines').innerHTML = html;
    // 创作背景：数据带 b 字段才显示（目前毛主席诗词全量，唐诗宋词无）
    var bg = $('sc-read-bg');
    if (p.b) {
      bg.innerHTML = '<h4>创作背景</h4><p>' + esc(p.b) + '</p>';
      bg.classList.remove('sc-hidden');
    } else {
      bg.innerHTML = '';
      bg.classList.add('sc-hidden');
    }
    $('sc-read-idx').textContent = (readCtx.index + 1) + ' / ' + readCtx.items.length;
    $('sc-read-fav').textContent = isFav(p.id) ? '★' : '☆';
    $('sc-read-fav').classList.toggle('sc-faved', isFav(p.id));
    $('sc-read-prev').style.visibility = readCtx.index > 0 ? 'visible' : 'hidden';
    $('sc-read-next').style.visibility = readCtx.index < readCtx.items.length - 1 ? 'visible' : 'hidden';
  }
  function readBack() {
    if (listCtx) { showView('sc-view-list'); } else { showView('sc-view-home'); }
  }

  /* ---------- 今日在读（按日期固定，可换） ---------- */
  var dailyPool = null, dailyIdx = 0;
  function dayIndex() {
    var d = new Date();
    return Math.floor((d.getFullYear() * 372 + (d.getMonth() + 1) * 31 + d.getDate()) % ALL.length);
  }
  function showDaily(advance) {
    if (!ALL.length) return;
    if (!dailyPool) { dailyIdx = dayIndex(); dailyPool = ALL; }
    if (advance) dailyIdx = (dailyIdx + 1) % ALL.length;
    var p = ALL[dailyIdx];
    $('sc-daily-title').textContent = (p.t || p.p || '无题');
    $('sc-daily-author').textContent = p.a + ' · ' + (p.dyn || '') +
      (p.p && (p.t || '').indexOf(p.p) === -1 ? ' · ' + p.p : '');
    $('sc-daily-lines').textContent = p.c.join(' ');
    $('sc-daily-more').onclick = function () { openRead(ALL, dailyIdx); };
  }

  /* ---------- 作者库 / 词牌库 ---------- */
  function renderAuthors() {
    var groups = { 唐: {}, 宋: {}, 现代: {}, 其他: {} };
    for (var k = 0; k < ALL.length; k++) {
      var p = ALL[k], g = groups[p.dyn === '唐' ? '唐' : (p.dyn === '宋' ? '宋' : (p.dyn === '现代' ? '现代' : '其他'))];
      g[p.a] = (g[p.a] || 0) + 1;
    }
    var html = '';
    var names = ['唐', '宋', '现代', '其他'], uniq = {};
    for (var n = 0; n < names.length; n++) {
      var g2 = groups[names[n]], arr = [];
      for (var name in g2) if (g2.hasOwnProperty(name)) { arr.push([name, g2[name]]); uniq[name] = 1; }
      arr.sort(function (x, y) { return y[1] - x[1]; });
      if (!arr.length) continue;
      // 分组标题："唐"→"唐代"，"现代"已含"代"不重复拼接
      var glabel = names[n] === '现代' || names[n] === '其他' ? names[n] : names[n] + '代';
      html += '<div class="sc-auth-group"><h3>' + glabel + ' · ' + arr.length + ' 人</h3><div class="sc-auth-grid">';
      for (var m = 0; m < arr.length; m++) {
        html += '<div class="sc-auth-cell" data-author="' + esc(arr[m][0]) + '" data-dyn="' + names[n] + '">' +
          '<div class="sc-auth-name">' + esc(arr[m][0]) + '</div><div class="sc-auth-n">' + arr[m][1] + ' 首</div></div>';
      }
      html += '</div></div>';
    }
    var total = 0; for (var u in uniq) if (uniq.hasOwnProperty(u)) total++;
    $('sc-authors-wrap').innerHTML = html;
    $('sc-authors-count').textContent = total + ' 人';
  }
  function renderCipai() {
    var cnt = {}, arr = [];
    for (var k = 0; k < SONG.length; k++) {
      var cp = SONG[k].p || SONG[k].t;
      cnt[cp] = (cnt[cp] || 0) + 1;
    }
    for (var name in cnt) if (cnt.hasOwnProperty(name)) arr.push([name, cnt[name]]);
    arr.sort(function (x, y) { return y[1] - x[1]; });
    var html = '';
    for (var m = 0; m < arr.length; m++) {
      html += '<button class="sc-cipai-chip' + (arr[m][1] >= 10 ? ' sc-hot' : '') + '" data-cipai="' + esc(arr[m][0]) + '">' +
        esc(arr[m][0]) + '<i>' + arr[m][1] + '</i></button>';
    }
    $('sc-cipai-wrap').innerHTML = html;
    $('sc-cipai-count').textContent = arr.length + ' 个';
  }

  /* ---------- 首页统计 ---------- */
  function updateCatCounts() {
    $('sc-cat-tang-n').textContent = TANG.length + ' 首';
    $('sc-cat-song-n').textContent = SONG.length + ' 首';
    $('sc-cat-mao-n').textContent = MAO.length + ' 首';
    var authors = {};
    for (var k = 0; k < ALL.length; k++) authors[ALL[k].a] = 1;
    var na = 0; for (var a in authors) if (authors.hasOwnProperty(a)) na++;
    $('sc-cat-author-n').textContent = na + ' 人';
    var cps = {};
    for (var s = 0; s < SONG.length; s++) cps[SONG[s].p || SONG[s].t] = 1;
    var nc = 0; for (var cp in cps) if (cps.hasOwnProperty(cp)) nc++;
    $('sc-cat-cipai-n').textContent = nc + ' 个';
    $('sc-cat-fav-n').textContent = loadFav().length + ' 首';
    $('sc-stats-line').textContent = '收录唐诗 ' + TANG.length + ' 首、宋词 ' + SONG.length +
      ' 首、毛主席诗词 ' + MAO.length + ' 首，共 ' + ALL.length + ' 首（' + na + ' 位作者、' + nc + ' 个词牌）';
  }

  /* ---------- 事件绑定 ---------- */
  function bindEvents() {
    // 底部导航
    var tabs = document.querySelectorAll('.sc-tabbar button');
    for (var t = 0; t < tabs.length; t++) {
      (function (btn) {
        btn.onclick = function () {
          if (btn.getAttribute('data-view')) showView(btn.getAttribute('data-view'));
          else setListByType(btn.getAttribute('data-view-list'));
        };
      })(tabs[t]);
    }
    // 首页分类卡
    var cats = document.querySelectorAll('.sc-cat-card');
    for (var c = 0; c < cats.length; c++) {
      (function (btn) {
        btn.onclick = function () {
          if (btn.getAttribute('data-list')) setListByType(btn.getAttribute('data-list'));
          else if (btn.getAttribute('data-nav')) {
            if (btn.getAttribute('data-nav') === 'sc-view-authors') renderAuthors();
            if (btn.getAttribute('data-nav') === 'sc-view-cipai') renderCipai();
            showView(btn.getAttribute('data-nav'));
          }
        };
      })(cats[c]);
    }
    $('sc-btn-random').onclick = function () {
      if (!ALL.length) return;
      openRead(ALL, Math.floor(Math.random() * ALL.length));
    };
    $('sc-daily-switch').onclick = function () { showDaily(true); };

    // 搜索
    $('sc-search-btn').onclick = function () { doSearch($('sc-search-input').value); };
    $('sc-search-input').onkeydown = function (e) {
      if (e.keyCode === 13) doSearch(this.value);
    };

    // 列表：条目点击（事件委托：从命中元素向上回溯到带 data-id 的 <li>，点卡片任意位置均生效）
    $('sc-poem-list').onclick = function (e) {
      var el = e.target;
      while (el && el !== this && !(el.getAttribute && el.getAttribute('data-id'))) el = el.parentNode;
      if (!el || el === this) return;
      openReadById(el.getAttribute('data-id'), listCtx ? listCtx.items : ALL);
    };
    $('sc-load-more').onclick = loadBatch;
    $('sc-list-back').onclick = function () { showView('sc-view-home'); };

    // 阅读页
    $('sc-read-back').onclick = readBack;
    $('sc-read-prev').onclick = function () { if (readCtx.index > 0) { readCtx.index--; renderRead(); window.scrollTo(0, 0); } };
    $('sc-read-next').onclick = function () { if (readCtx.index < readCtx.items.length - 1) { readCtx.index++; renderRead(); window.scrollTo(0, 0); } };
    $('sc-read-fav').onclick = function () {
      var p = readCtx.items[readCtx.index];
      var added = toggleFav(p.id);
      $('sc-read-fav').textContent = added ? '★' : '☆';
      $('sc-read-fav').classList.toggle('sc-faved', added);
      toast(added ? '已收藏《' + (p.t || p.p) + '》' : '已取消收藏');
    };
    $('sc-read-copy').onclick = function () {
      var p = readCtx.items[readCtx.index];
      copyText(p.t + '\n' + p.a + '\n\n' + p.c.join('\n'), '已复制到剪贴板');
    };

    // 作者库 / 词牌库：条目点击
    $('sc-authors-wrap').onclick = function (e) {
      var el = e.target;
      while (el && el !== this && !(el.className && el.className.indexOf && el.className.indexOf('sc-auth-cell') !== -1)) el = el.parentNode;
      if (el === this) return;
      var author = el.getAttribute('data-author');
      var items = filterByAuthor(ALL, author);
      openList('author', author + '（' + items.length + ' 首）', items);
    };
    $('sc-cipai-wrap').onclick = function (e) {
      var el = e.target;
      while (el && el !== this && !(el.className && el.className.indexOf && el.className.indexOf('sc-cipai-chip') !== -1)) el = el.parentNode;
      if (el === this) return;
      var cp = el.getAttribute('data-cipai'), items = [];
      for (var k = 0; k < SONG.length; k++) {
        if ((SONG[k].p || SONG[k].t) === cp) items.push(SONG[k]);
      }
      openList('cipai', '词牌《' + cp + '》', items);
    };
    $('sc-cipai-back').onclick = function () { showView('sc-view-home'); };
    $('sc-authors-back').onclick = function () { showView('sc-view-home'); };
  }

  /* ---------- Service Worker（单文件 file:// 打开时自动跳过） ---------- */
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () {});
    });
  }

  /* ---------- 首次进入 ---------- */
  function init() {
    var d = new Date(), p2 = function (x) { return x < 10 ? '0' + x : '' + x; };
    var week = ['日', '一', '二', '三', '四', '五', '六'];
    $('sc-home-date').textContent = d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 · 星期' + week[d.getDay()];
    var ver = 'v1.2.2';
    try {
      var m = document.querySelector('meta[name="app-version"]');
      if (m) ver = m.getAttribute('content');
    } catch (e) {}
    $('sc-version-line').textContent = '诗海 Shihai ' + ver + ' · ' + SC_VERSION;
    bindEvents();
    updateCatCounts();
    showDaily(false);
    if (!ALL.length) toast('未加载到诗词数据，请检查 data-*.js');
  }
  init();
})();
