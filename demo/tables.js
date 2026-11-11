/* Tablo kartları için: her <td>'ye sütun başlığını data-label olarak yazar (CSS: demo/mobile-cards.css). */
(function () {
  'use strict';
  function label(root) {
    (root || document).querySelectorAll('table.tbl').forEach(function (tb) {
      var heads = [].slice.call(tb.querySelectorAll('thead th')); if (!heads.length) return;
      var cols = []; heads.forEach(function (th) { for (var i = 0; i < (th.colSpan || 1); i++) cols.push((th.textContent || '').trim()); });
      tb.querySelectorAll('tbody tr').forEach(function (tr) { var c = 0; [].slice.call(tr.children).forEach(function (td) { if (td.tagName !== 'TD') return; var lab = cols[c] || ''; if (lab) { if (td.dataset.label !== lab) td.dataset.label = lab; } else if (td.dataset.label) delete td.dataset.label; c += td.colSpan || 1; }); });
    });
  }
  var raf = 0; new MutationObserver(function () { cancelAnimationFrame(raf); raf = requestAnimationFrame(function () { label(); }); }).observe(document.documentElement, { childList: true, subtree: true });
})();
