'use strict';
'require view';
'require rpc';
'require ui';

var callSmsList    = rpc.declare({ object: 'rm520n', method: 'sms_list', expect: {} });
var callSmsDelete  = rpc.declare({ object: 'rm520n', method: 'sms_delete', params: ['indexes'] });
var callUssd       = rpc.declare({ object: 'rm520n', method: 'ussd', params: ['code'] });
var callUssdCancel = rpc.declare({ object: 'rm520n', method: 'ussd_cancel' });

var CSS =
    '#rm520n-view{'
    + '--bg:#0f172a;--card:#1e293b;--border:#334155;'
    + '--text:#e2e8f0;--muted:#94a3b8;--accent:#3b82f6;'
    + '--green:#22c55e;--amber:#f59e0b;--red:#ef4444;'
    + 'background:var(--bg);padding:16px;'
    + 'font-family:ui-monospace,SFMono-Regular,monospace;color:var(--text)}'
    + '.rm-card{'
    + 'background:var(--card);border:1px solid var(--border);border-radius:8px;'
    + 'padding:16px;margin-bottom:12px}'
    + '.rm-card h3{'
    + 'margin:0 0 12px;font-size:.78em;text-transform:uppercase;'
    + 'letter-spacing:.08em;color:var(--muted)}'
    + '.rm-hint{font-size:.75em;color:var(--muted);margin-top:2px}'
    + '.rm-controls{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}'
    + '.rm-input{'
    + 'background:var(--bg);border:1px solid var(--border);color:var(--text);'
    + 'padding:6px 10px;border-radius:6px;font-family:inherit;max-width:220px;box-sizing:border-box}'
    + '.rm-btn{padding:6px 14px;border-radius:6px;border:none;cursor:pointer;font-weight:600;font-size:.85em}'
    + '.rm-btn-primary{background:var(--accent);color:#fff}'
    + '.rm-btn-danger{background:var(--red);color:#fff}'
    + '.rm-btn-default{background:#334155;color:var(--text)}'
    + '.rm-sms{border:1px solid var(--border);border-radius:6px;padding:10px 12px;margin-top:8px;background:var(--bg)}'
    + '.rm-sms-new{border-color:var(--accent)}'
    + '.rm-sms-head{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;font-size:.8em;color:var(--muted)}'
    + '.rm-sms-from{color:var(--text);font-weight:600;font-size:1.1em}'
    + '.rm-sms-text{margin:8px 0 0;white-space:pre-wrap;word-break:break-word;line-height:1.45}'
    + '.rm-sms-del{margin-left:auto}'
    + '.rm-badge{padding:1px 6px;border-radius:4px;font-size:.85em}'
    + '.rm-badge-new{background:var(--accent);color:#fff}'
    + '.rm-badge-warn{background:var(--amber);color:#111}'
    + '.rm-empty{color:var(--muted);font-size:.85em}'
    + '.rm-ussd-out{margin-top:10px;padding:10px 12px;border:1px solid var(--border);border-radius:6px;'
    + 'background:var(--bg);white-space:pre-wrap;word-break:break-word;line-height:1.45}';

// 3GPP TS 23.038 default alphabet and extension table
var GSM7 = ('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1bÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?'
    + '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà').split('');
var GSM7_EXT = { 10: '\f', 20: '^', 40: '{', 41: '}', 47: '\\', 60: '[', 61: '~', 62: ']', 64: '|', 101: '€' };

function hexBytes(hex) {
    var b = [];
    for (var i = 0; i + 1 < hex.length; i += 2) b.push(parseInt(hex.substr(i, 2), 16));
    return b;
}

function unpack7(bytes, startBit, count) {
    var out = [];
    for (var i = 0, bit = startBit; i < count; i++, bit += 7) {
        var p = bit >> 3, sh = bit & 7;
        out.push(((bytes[p] >> sh) | ((bytes[p + 1] || 0) << (8 - sh))) & 0x7f);
    }
    return out;
}

function gsm7Text(septets) {
    var s = '';
    for (var i = 0; i < septets.length; i++) {
        if (septets[i] === 27 && i + 1 < septets.length) s += GSM7_EXT[septets[++i]] || ' ';
        else s += GSM7[septets[i]];
    }
    return s;
}

function ucs2Text(bytes) {
    var s = '';
    for (var i = 0; i + 1 < bytes.length; i += 2) s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    return s;
}

function semiOctets(bytes) {
    return bytes.map(function(b) {
        return (b & 0x0f).toString(16) + (b >> 4).toString(16);
    }).join('').replace(/f+$/i, '');
}

function bcdSwap(b) { return (b & 0x0f) * 10 + (b >> 4); }

// 0 = GSM7, 1 = 8-bit data, 2 = UCS2
function dcsAlphabet(dcs) {
    var group = dcs & 0xf0;
    if ((dcs & 0xc0) === 0 || (dcs & 0xc0) === 0x40) return (dcs >> 2) & 3;
    if (group === 0xf0) return (dcs & 0x04) ? 1 : 0;
    if (group === 0xe0) return 2;
    return 0;
}

// Decodes an SMS-DELIVER PDU. Returns null for other PDU types.
function decodePdu(hex) {
    var b = hexBytes(hex), p = 0;
    p += 1 + b[p];
    var fo = b[p++];
    if ((fo & 3) !== 0) return null;

    var oaLen = b[p++], oaType = b[p++], oaBytes = b.slice(p, p + Math.ceil(oaLen / 2));
    p += oaBytes.length;
    var from = (oaType & 0x70) === 0x50
        ? gsm7Text(unpack7(oaBytes, 0, Math.floor(oaLen * 4 / 7)))
        : ((oaType & 0x70) === 0x10 ? '+' : '') + semiOctets(oaBytes);

    p++;
    var dcs = b[p++];
    var ts = b.slice(p, p + 7);
    p += 7;
    var tzRaw = ((ts[6] & 0x0f) << 4) | (ts[6] >> 4);
    var tzMin = (((tzRaw & 0x70) >> 4) * 10 + (tzRaw & 0x0f)) * 15 * ((tzRaw & 0x80) ? -1 : 1);
    var time = (Date.UTC(2000 + bcdSwap(ts[0]), bcdSwap(ts[1]) - 1, bcdSwap(ts[2]),
        bcdSwap(ts[3]), bcdSwap(ts[4]), bcdSwap(ts[5])) - tzMin * 60000) / 1000;

    var udl = b[p++], ud = b.slice(p), udhLen = 0, ref = null, total = 1, seq = 1;
    if (fo & 0x40) {
        udhLen = ud[0] + 1;
        for (var i = 1; i < udhLen; ) {
            var iei = ud[i], len = ud[i + 1], d = ud.slice(i + 2, i + 2 + len);
            if (iei === 0 && len === 3) { ref = d[0]; total = d[1]; seq = d[2]; }
            if (iei === 8 && len === 4) { ref = (d[0] << 8) | d[1]; total = d[2]; seq = d[3]; }
            i += 2 + len;
        }
    }

    var text, alpha = dcsAlphabet(dcs);
    if (alpha === 0) {
        var skip = Math.ceil(udhLen * 8 / 7);
        text = gsm7Text(unpack7(ud, skip * 7, udl - skip));
    } else if (alpha === 2) {
        text = ucs2Text(ud.slice(udhLen, udl));
    } else {
        text = '[' + _('binary data') + '] ' + hex.substr((b.length - ud.length + udhLen) * 2);
    }
    return { from: from, time: time, text: text, ref: ref, total: total, seq: seq };
}

// Joins multipart messages and returns them newest first.
function buildMessages(raw) {
    var groups = {}, list = [];
    (raw || []).forEach(function(m) {
        var d = null;
        try { d = decodePdu(m.pdu); } catch (e) {}
        if (!d) {
            list.push({ indexes: [m.index], from: '?', time: 0, text: _('Unsupported message type'),
                unread: m.stat === 0, parts: 1, total: 1 });
            return;
        }
        var key = d.ref !== null ? d.from + '|' + d.ref + '|' + d.total : 'single|' + m.index;
        var g = groups[key];
        if (!g) {
            g = groups[key] = { indexes: [], from: d.from, time: d.time, parts: {}, total: d.total, unread: false };
            list.push(g);
        }
        g.indexes.push(m.index);
        g.parts[d.seq] = d.text;
        g.time = Math.min(g.time, d.time);
        if (m.stat === 0) g.unread = true;
    });
    list.forEach(function(g) {
        if (typeof g.parts !== 'object') return;
        var seqs = Object.keys(g.parts).map(Number).sort(function(a, b) { return a - b; });
        g.text = seqs.map(function(s) { return g.parts[s]; }).join('');
        g.parts = seqs.length;
    });
    return list.sort(function(a, b) { return b.time - a.time; });
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function fmtTime(t) {
    if (!t) return '';
    var d = new Date(t * 1000);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
        + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function parseUssd(raw) {
    var m = /\+CUSD:\s*(\d)(?:\s*,\s*"([\s\S]*)"\s*,\s*(\d+))?/.exec(raw || '');
    if (!m) return null;
    var text = m[2] || '', dcs = parseInt(m[3]) || 0;
    if (dcsAlphabet(dcs) === 2 && /^([0-9A-Fa-f]{4})+$/.test(text)) text = ucs2Text(hexBytes(text));
    return { status: parseInt(m[1]), text: text };
}

function replaceContent(id, node) {
    var el = document.getElementById(id);
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
    el.appendChild(node);
}

function confirmDelete(msg) {
    ui.showModal(_('Delete message'), [
        E('p', _('Delete this message from the modem? This cannot be undone.')),
        E('div', { 'class': 'right' }, [
            E('button', { 'class': 'btn cbi-button', 'click': ui.hideModal }, _('Cancel')),
            ' ',
            E('button', { 'class': 'btn cbi-button cbi-button-reset',
                'click': function() {
                    ui.hideModal();
                    callSmsDelete(msg.indexes.join(',')).then(function(r) {
                        if (r && r.error) ui.addNotification(null, E('p', r.error), 'error');
                        return refreshInbox();
                    });
                }
            }, _('Delete'))
        ])
    ]);
}

function buildInbox(res) {
    if (!res || res.error) {
        return E('div', { 'class': 'rm-empty' }, (res && res.error) || _('No answer from the modem.'));
    }
    var msgs = buildMessages(res.messages);
    var head = E('div', { 'class': 'rm-hint' },
        _('Storage %s: %s / %s used').format(res.storage || '?',
            res.used != null ? res.used : '?', res.total != null ? res.total : '?'));
    if (!msgs.length) {
        return E('div', {}, [ head, E('div', { 'class': 'rm-empty', 'style': 'margin-top:8px' }, _('No messages.')) ]);
    }
    return E('div', {}, [ head ].concat(msgs.map(function(m) {
        var badges = [];
        if (m.unread) badges.push(E('span', { 'class': 'rm-badge rm-badge-new' }, _('new')));
        if (m.parts < m.total) {
            badges.push(E('span', { 'class': 'rm-badge rm-badge-warn' },
                _('incomplete %d/%d').format(m.parts, m.total)));
        }
        return E('div', { 'class': 'rm-sms' + (m.unread ? ' rm-sms-new' : '') }, [
            E('div', { 'class': 'rm-sms-head' }, [
                E('span', { 'class': 'rm-sms-from' }, m.from),
                E('span', {}, fmtTime(m.time))
            ].concat(badges).concat([
                E('button', { 'class': 'rm-btn rm-btn-default rm-sms-del',
                    'click': function() { confirmDelete(m); } }, _('Delete'))
            ])),
            E('div', { 'class': 'rm-sms-text' }, m.text)
        ]);
    })));
}

function refreshInbox() {
    return callSmsList().then(function(res) { replaceContent('sms-inbox', buildInbox(res)); });
}

function showUssd(res) {
    var r = res && !res.error ? parseUssd(res.raw) : null;
    var node;
    if (!r) {
        node = E('div', { 'class': 'rm-ussd-out rm-empty' },
            (res && res.error) || _('No answer from the network. Check the code or try again.'));
    } else if (r.status === 2) {
        node = E('div', { 'class': 'rm-ussd-out rm-empty' }, _('Session closed by the network.'));
    } else if (r.status > 2) {
        node = E('div', { 'class': 'rm-ussd-out rm-empty' }, _('The network did not accept the request.'));
    } else {
        node = E('div', { 'class': 'rm-ussd-out' }, r.text);
    }
    replaceContent('ussd-out', node);
    var menu = document.getElementById('ussd-menu');
    if (menu) menu.style.display = r && r.status === 1 ? '' : 'none';
}

function sendUssd(inputId) {
    var input = document.getElementById(inputId);
    var code = input ? input.value.trim() : '';
    if (!/^[0-9*#]+$/.test(code)) {
        ui.addNotification(null, E('p', _('A USSD code may only contain digits, * and #.')), 'error');
        return;
    }
    replaceContent('ussd-out', E('div', { 'class': 'rm-ussd-out rm-empty' }, _('Waiting for the network...')));
    return callUssd(code).then(function(res) {
        if (inputId === 'ussd-reply') input.value = '';
        showUssd(res);
    });
}

return view.extend({
    load: function() {
        return callSmsList();
    },

    render: function(res) {
        var inboxCard = E('div', { 'class': 'rm-card' }, [
            E('h3', {}, _('SMS Inbox')),
            E('div', { 'id': 'sms-inbox' }, [ buildInbox(res) ]),
            E('div', { 'class': 'rm-controls' }, [
                E('button', { 'class': 'rm-btn rm-btn-default', 'click': function() { refreshInbox(); } },
                    _('Refresh'))
            ])
        ]);

        var ussdCard = E('div', { 'class': 'rm-card' }, [
            E('h3', {}, _('USSD')),
            E('div', { 'class': 'rm-hint', 'style': 'margin:0 0 10px' },
                _('Send a code such as a balance check to your operator. The answer can take up to 15 seconds.')),
            E('div', { 'class': 'rm-controls', 'style': 'margin-top:0' }, [
                E('input', { 'type': 'text', 'id': 'ussd-code', 'class': 'rm-input', 'placeholder': '*100#',
                    'keydown': function(ev) { if (ev.key === 'Enter') sendUssd('ussd-code'); } }),
                E('button', { 'class': 'rm-btn rm-btn-primary', 'click': function() { sendUssd('ussd-code'); } },
                    _('Send'))
            ]),
            E('div', { 'id': 'ussd-out' }),
            E('div', { 'id': 'ussd-menu', 'class': 'rm-controls', 'style': 'display:none' }, [
                E('input', { 'type': 'text', 'id': 'ussd-reply', 'class': 'rm-input', 'placeholder': _('Reply'),
                    'keydown': function(ev) { if (ev.key === 'Enter') sendUssd('ussd-reply'); } }),
                E('button', { 'class': 'rm-btn rm-btn-primary', 'click': function() { sendUssd('ussd-reply'); } },
                    _('Reply')),
                E('button', { 'class': 'rm-btn rm-btn-default',
                    'click': function() {
                        callUssdCancel().then(function() {
                            showUssd({ raw: '+CUSD: 2' });
                        });
                    }
                }, _('End session'))
            ])
        ]);

        return E('div', { 'id': 'rm520n-view' }, [
            E('style', {}, CSS),
            inboxCard,
            ussdCard
        ]);
    },

    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});
