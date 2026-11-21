/*
 * Pulse link page. A shared link looks like
 *   https://<host>/join#g=<group id>&a=<admin key>&n=<group name>      (a group)
 *   https://<host>/add#k=<person's key>&n=<name>                       (a person)
 * Everything after the "#" stays on the phone: the browser never sends it to the web server.
 * The page shows what the link is for, a button that opens Pulse, and a download for people who do not have it yet.
 */
(function () {
  var APK = 'https://github.com/BusyBoyRahul/Pulse/releases/latest/download/Pulse.apk';
  var kind = document.body.getAttribute('data-kind'); // 'join' or 'add'

  var params = {};
  location.hash.replace(/^#/, '').split('&').forEach(function (part) {
    if (!part) return;
    var i = part.indexOf('=');
    var k = i < 0 ? part : part.slice(0, i);
    var v = i < 0 ? '' : part.slice(i + 1);
    try { params[k] = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { /* ignore */ }
  });

  var safe = /^[A-Za-z0-9_\-]{3,80}$/;
  var name = (params.n || '').replace(/[\u0000-\u001f]/g, '').slice(0, 40).trim();
  var ok = kind === 'join' ? safe.test(params.g || '') && safe.test(params.a || '') : safe.test(params.k || '');

  function $(id) { return document.getElementById(id); }

  // The same coloured circle with initials that the app draws for a person without a photo (same colours, same pick from the key),
  // and the blue "people" circle for a group.
  var COLORS = ['#7C5CFF', '#2F8BFF', '#12B981', '#FF6B5B', '#F0457E', '#14B8C6', '#5B6CFF', '#F5A524'];
  function hash(str) { var h = 0; for (var i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) | 0; } return Math.abs(h); }
  function standardKey(s) { var b = s.replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '='; return b; }
  function initials(n) {
    var parts = n.replace(/\(.*?\)/g, ' ').split(/\s+/).map(function (w) { return w.replace(/[^\p{L}\p{N}]/gu, ''); }).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  function drawAvatar() {
    var el = $('avatar');
    if (kind === 'join') {
      el.style.background = '#2F8BFF';
      el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.4-3 2.6-4.8 5.5-4.8s5.1 1.8 5.5 4.8"/><path d="M15.5 5.3a3.2 3.2 0 0 1 0 5.4M17.5 14.6c1.7.6 2.9 2.1 3.2 4.4"/></svg>';
    } else {
      el.style.background = COLORS[hash(standardKey(params.k)) % COLORS.length];
      el.textContent = initials(name || 'Pulse user');
    }
  }

  if (!ok) {
    $('title').textContent = 'This link is not complete';
    $('sub').textContent = 'Ask the person to send it again.';
    $('card').style.display = 'none';
    $('avatar').style.display = 'none';
    $('open').style.display = 'none';
    $('sub').className += ' bad';
    return;
  }

  // The same link, in the form the app understands.
  var app = kind === 'join'
    ? 'pulse://group?g=' + encodeURIComponent(params.g) + '&a=' + encodeURIComponent(params.a) + '&n=' + encodeURIComponent(name || 'Group')
    : 'pulse://add?k=' + encodeURIComponent(params.k) + '&n=' + encodeURIComponent(name || 'Pulse user');

  drawAvatar();
  $('title').textContent = kind === 'join' ? 'Join ' + (name || 'this group') + ' on Pulse' : (name || 'Someone') + ' wants to connect on Pulse';
  $('sub').textContent = kind === 'join'
    ? 'A private, end-to-end encrypted group. An admin has to say yes before you are in.'
    : 'Pulse is a private messenger that also works with no internet.';

  var isAndroid = /Android/i.test(navigator.userAgent);
  // On Android, an "intent:" link opens Pulse if it is installed and otherwise goes to the download.
  var intent = 'intent://' + app.replace(/^pulse:\/\//, '') + '#Intent;scheme=pulse;package=com.pulse;S.browser_fallback_url=' + encodeURIComponent(APK) + ';end';
  $('open').setAttribute('href', isAndroid ? intent : app);
  $('dl').setAttribute('href', APK);
  if (!isAndroid) {
    $('device').textContent = 'Pulse is an Android app. Open this link on your Android phone.';
  }
})();
