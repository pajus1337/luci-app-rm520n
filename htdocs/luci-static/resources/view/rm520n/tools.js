'use strict';
'require view';
'require rpc';
'require ui';

var callReconnect  = rpc.declare({ object: 'rm520n', method: 'reconnect' });
var callReboot     = rpc.declare({ object: 'rm520n', method: 'reboot_modem' });
var callGetConfig  = rpc.declare({ object: 'rm520n', method: 'get_config', expect: {} });
var callGetEvents  = rpc.declare({ object: 'rm520n', method: 'get_events', expect: {} });
var callSetConfig  = rpc.declare({ object: 'rm520n', method: 'set_config',
    params: ['enabled', 'ping_host', 'fail_threshold', 'action', 'interval', 'ping_host2', 'log_dir', 'events_max', 'cell_log'] });

var CSS =
    '#rm520n-view{'
    + '--bg:#0f172a;--card:#1e293b;--border:#334155;'
    + '--text:#e2e8f0;--muted:#94a3b8;--accent:#3b82f6;'
    + '--green:#22c55e;--lime:#84cc16;--amber:#f59e0b;--orange:#f97316;--red:#ef4444;'
    + 'background:var(--bg);padding:16px;'
    + 'font-family:ui-monospace,SFMono-Regular,monospace;color:var(--text)}'
    + '.rm-card{'
    + 'background:var(--card);border:1px solid var(--border);border-radius:8px;'
    + 'padding:16px;margin-bottom:12px}'
    + '.rm-card h3{'
    + 'margin:0 0 12px;font-size:.78em;text-transform:uppercase;'
    + 'letter-spacing:.08em;color:var(--muted)}'
    + '.rm-table{width:100%;border-collapse:collapse}'
    + '.rm-table td{padding:6px 0;vertical-align:middle}'
    + '.rm-table td:first-child{'
    + 'color:var(--muted);font-size:.85em;white-space:nowrap;'
    + 'padding-right:16px;width:38%}'
    + '.rm-hint{font-size:.75em;color:var(--muted);margin-top:2px}'
    + '.rm-controls{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}'
    + '.rm-input{'
    + 'background:var(--bg);border:1px solid var(--border);color:var(--text);'
    + 'padding:6px 10px;border-radius:6px;font-family:inherit;width:100%;box-sizing:border-box}'
    + '.rm-btn{padding:6px 14px;border-radius:6px;border:none;cursor:pointer;font-weight:600;font-size:.85em}'
    + '.rm-btn-primary{background:var(--accent);color:#fff}'
    + '.rm-btn-danger{background:var(--red);color:#fff}'
    + '.rm-btn-default{background:#334155;color:var(--text)}'
    + '.rm-select{background:var(--bg);border:1px solid var(--border);color:var(--text);'
    + 'padding:6px 10px;border-radius:6px;font-family:inherit;font-size:.85em;width:100%}'
    + '.rm-toggle{position:relative;display:inline-block;width:40px;height:22px}'
    + '.rm-toggle input{opacity:0;width:0;height:0}'
    + '.rm-toggle-slider{'
    + 'position:absolute;cursor:pointer;inset:0;background:#334155;border-radius:22px;transition:.2s}'
    + '.rm-toggle-slider:before{'
    + 'position:absolute;content:"";height:16px;width:16px;left:3px;bottom:3px;'
    + 'background:#94a3b8;border-radius:50%;transition:.2s}'
    + '.rm-toggle input:checked + .rm-toggle-slider{background:var(--accent)}'
    + '.rm-toggle input:checked + .rm-toggle-slider:before{transform:translateX(18px);background:#fff}'
    + '.rm-status-ok{color:var(--green)}'
    + '.rm-status-warn{color:var(--amber)}'
    + '.rm-status-err{color:var(--red)}'
    + '.rm-status-off{color:var(--muted)}'
    + '.rm-history{'
    + 'max-height:180px;overflow-y:auto;background:var(--bg);border:1px solid var(--border);'
    + 'border-radius:6px;padding:8px 10px;font-size:.78em;line-height:1.5}'
    + '.rm-history-empty{color:var(--muted)}'
    + '.rm-history-line{white-space:pre-wrap;word-break:break-all;color:var(--text)}'
    + '.rm-events{max-height:320px}'
    + '.rm-events table{width:100%;border-collapse:collapse}'
    + '.rm-events td{padding:3px 10px 3px 0;vertical-align:top}'
    + '.rm-events td:first-child{color:var(--muted);white-space:nowrap}'
    + '.rm-events td:nth-child(2){white-space:nowrap}';

var ACTION_LABELS = {
    'reconnect':     _('Reconnect only (CFUN=4→1, ~5 s)'),
    'reboot_modem':  _('Reboot modem (AT+CFUN=1,1, ~40-45 s)'),
    'cascade':       _('Cascade: reconnect → reboot modem → reboot router'),
    'reboot_router': _('Reboot router (full OpenWrt restart, ~60 s)'),
    'monitor':       _('Monitor only (log incidents, no recovery action)')
};

var VERDICT_LABELS = {
    'modem_unreachable': _('Modem/board unreachable'),
    'no_route':          _('No default route'),
    'wwan_down':         _('Mobile data down'),
    'target_only':       _('Only primary host unreachable')
};

function parseEvent(line) {
    var p = String(line).split(' ');
    var kv = {};
    p.slice(2).forEach(function(x) {
        var i = x.indexOf('=');
        if (i > 0) kv[x.slice(0, i)] = x.slice(i + 1);
    });
    return { t: parseInt(p[0]) || 0, type: p[1] || '', kv: kv };
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function fmtTime(t) {
    var d = new Date(t * 1000);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
        + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

function fmtDuration(sec) {
    var s = parseInt(sec) || 0;
    if (s < 60) return s + ' s';
    if (s < 3600) return Math.floor(s / 60) + ' min ' + (s % 60) + ' s';
    return Math.floor(s / 3600) + ' h ' + Math.floor((s % 3600) / 60) + ' min';
}

function verdictLabel(v) { return VERDICT_LABELS[v] || v || '?'; }

function cellSig(kv) {
    return [kv.tech, kv.band, kv.pci, kv.cell].join('|');
}

function cellText(kv) {
    if (kv.modem) return _('modem did not answer');
    var parts = [ _('%s band %s').format(kv.tech || '?', kv.band || '?'),
        'PCI ' + (kv.pci || '?'), _('cell %s').format(kv.cell || '?') ];
    if (kv.scc && kv.scc !== 'none') parts.push('SCC ' + kv.scc);
    if (kv.rsrp) parts.push('RSRP ' + kv.rsrp + ' dBm, SINR ' + (kv.sinr || '?') + ' dB');
    return parts.join(', ');
}

// Adds .label/.cls/.details to each event and collects 24 h totals. A cell
// line equal to the previous one is the baseline the watchdog logs on start,
// not a change.
function analyseEvents(lines) {
    var evs = (lines || []).map(parseEvent);
    var since = Math.floor(Date.now() / 1000) - 86400;
    var sum = { outages: {}, outageCount: 0, outageSec: 0, targetOnly: 0, cellChanges: 0, actions: 0 };
    var prevCell = null;
    evs.forEach(function(e) {
        var recent = e.t >= since;
        switch (e.type) {
        case 'incident_start':
            e.label = _('Outage: %s').format(verdictLabel(e.kv.verdict));
            e.cls = e.kv.verdict === 'target_only' ? 'rm-status-warn' : 'rm-status-err';
            e.details = cellText(e.kv);
            if (recent && e.kv.verdict === 'target_only') sum.targetOnly++;
            else if (recent) {
                sum.outageCount++;
                sum.outages[e.kv.verdict] = (sum.outages[e.kv.verdict] || 0) + 1;
            }
            break;
        case 'incident_end':
            e.label = _('Recovered');
            e.cls = 'rm-status-ok';
            e.details = _('%s, after %s').format(verdictLabel(e.kv.verdict), fmtDuration(e.kv.duration));
            if (recent && e.kv.verdict !== 'target_only') sum.outageSec += parseInt(e.kv.duration) || 0;
            break;
        case 'cell':
            var changed = prevCell !== null && prevCell !== cellSig(e.kv);
            e.label = changed ? _('Cell change') : _('Serving cell');
            e.cls = changed ? 'rm-status-warn' : '';
            e.details = cellText(e.kv);
            if (recent && changed) sum.cellChanges++;
            prevCell = cellSig(e.kv);
            break;
        case 'action':
            e.label = _('Recovery action');
            e.cls = 'rm-status-warn';
            e.details = e.kv.name || '?';
            if (recent) sum.actions++;
            break;
        case 'action_skipped':
            e.label = _('Action skipped');
            e.cls = 'rm-status-off';
            e.details = _('%s: no modem AT port').format(e.kv.action || '?');
            break;
        default:
            e.label = e.type;
            e.cls = '';
            e.details = '';
        }
    });
    return { events: evs, sum: sum };
}

function buildEventsBlock(res) {
    var a = analyseEvents(res && res.events);
    var s = a.sum;
    var file = (res && res.file) || '/tmp/rm520n/events.log';

    var byVerdict = Object.keys(s.outages).map(function(v) {
        return s.outages[v] + '× ' + verdictLabel(v);
    }).join(', ');

    var rows = a.events.slice(-100).reverse().map(function(e) {
        return E('tr', {}, [
            E('td', {}, fmtTime(e.t)),
            E('td', { 'class': e.cls }, e.label),
            E('td', {}, e.details)
        ]);
    });

    return E('div', {}, [
        E('table', { 'class': 'rm-table' }, [
            E('tr', {}, [
                E('td', {}, _('Outages (24 h)')),
                E('td', { 'class': s.outageCount ? 'rm-status-err' : 'rm-status-ok' },
                    String(s.outageCount) + (byVerdict ? ' (' + byVerdict + ')' : ''))
            ]),
            E('tr', {}, [
                E('td', {}, _('Outage time (24 h)')),
                E('td', {}, fmtDuration(s.outageSec))
            ]),
            E('tr', {}, [
                E('td', {}, _('Only primary host unreachable (24 h)')),
                E('td', {}, String(s.targetOnly))
            ]),
            E('tr', {}, [
                E('td', {}, _('Cell changes (24 h)')),
                E('td', {}, String(s.cellChanges))
            ]),
            E('tr', {}, [
                E('td', {}, _('Recovery actions (24 h)')),
                E('td', {}, String(s.actions))
            ]),
            E('tr', {}, [
                E('td', {}, _('Log file')),
                E('td', {}, [ file,
                    file.indexOf('/tmp/') === 0
                        ? E('div', { 'class': 'rm-hint' }, _('In RAM, cleared on reboot. Set an event log directory above to keep it.'))
                        : '' ])
            ])
        ]),
        E('div', { 'class': 'rm-history rm-events', 'style': 'margin-top:10px' },
            rows.length ? [ E('table', {}, rows) ]
                        : [ E('div', { 'class': 'rm-history-empty' }, _('No events recorded yet.')) ])
    ]);
}

function refreshEvents() {
    return callGetEvents().then(function(res) {
        var el = document.getElementById('wd-events');
        if (!el) return;
        while (el.firstChild) el.removeChild(el.firstChild);
        el.appendChild(buildEventsBlock(res));
    });
}

function fmtRelativeTime(epochSec) {
    var t = parseInt(epochSec);
    if (!t) return _('never');
    var d = Math.max(0, Math.floor(Date.now() / 1000) - t);
    if (d < 60) return _('%ds ago').format(d);
    if (d < 3600) return _('%dm ago').format(Math.floor(d / 60));
    if (d < 86400) return _('%dh ago').format(Math.floor(d / 3600));
    return _('%dd ago').format(Math.floor(d / 86400));
}

function buildHistoryBlock(history) {
    if (!history || !history.length) {
        return E('div', { 'class': 'rm-history' }, [
            E('div', { 'class': 'rm-history-empty' }, _('No events recorded yet.'))
        ]);
    }
    return E('div', { 'class': 'rm-history' },
        history.slice().reverse().map(function(line) {
            return E('div', { 'class': 'rm-history-line' }, line);
        })
    );
}

function toggleLabel(enabled) {
    return E('label', { 'class': 'rm-toggle' }, [
        E('input', { 'type': 'checkbox', 'id': 'wd-enabled',
            'checked': enabled ? true : null }),
        E('span', { 'class': 'rm-toggle-slider' })
    ]);
}

function statusText(wd) {
    if (!wd || String(wd.enabled) !== '1') {
        return E('span', { 'class': 'rm-status-off' }, _('Disabled'));
    }
    var fails = parseInt(wd.fail_count) || 0;
    var thr   = parseInt(wd.fail_threshold) || 3;
    var ivl   = parseInt(wd.interval) || 10;
    if (fails === 0) {
        return E('span', { 'class': 'rm-status-ok' },
            _('Active - polling every %ds, no failures').format(ivl));
    }
    var cls = fails >= thr ? 'rm-status-err' : 'rm-status-warn';
    return E('span', { 'class': cls },
        _('%d / %d consecutive failures').format(fails, thr));
}

function makeSelect(id, options, current) {
    return E('select', { 'id': id, 'class': 'rm-select' },
        options.map(function(o) {
            var opt = E('option', { 'value': o.v }, o.l);
            if (o.v === current) opt.selected = true;
            return opt;
        })
    );
}

return view.extend({
    load: function() {
        return Promise.all([ callGetConfig(), callGetEvents() ]);
    },

    render: function(data) {
        var d = (data && data[0]) || {};
        var events = data && data[1];
        var wd = d.watchdog || {};

        var curAction   = wd.action        || 'reboot_modem';
        var curThresh   = String(wd.fail_threshold || 3);
        var curInterval = String(wd.interval || 10);

        var actionsCard = E('div', { 'class': 'rm-card' }, [
            E('h3', {}, _('Manual Actions')),
            E('div', { 'class': 'rm-controls', 'style': 'margin-top:0' }, [
                E('button', { 'class': 'rm-btn rm-btn-primary',
                    'click': function() {
                        ui.showModal(_('Reconnect Modem'), [
                            E('p', _('Soft reconnect (CFUN=4 → CFUN=1). Connection will drop for ~5 seconds.')),
                            E('div', { 'class': 'right' }, [
                                E('button', { 'class': 'btn cbi-button',
                                    'click': ui.hideModal }, _('Cancel')),
                                ' ',
                                E('button', { 'class': 'btn cbi-button cbi-button-apply',
                                    'click': function() {
                                        callReconnect();
                                        ui.hideModal();
                                        ui.addNotification(null,
                                            E('p', _('Reconnecting modem...')), 'info');
                                    }
                                }, _('Reconnect'))
                            ])
                        ]);
                    }
                }, _('Reconnect')),
                E('button', { 'class': 'rm-btn rm-btn-danger',
                    'click': function() {
                        ui.showModal(_('Reboot Modem'), [
                            E('p', _('Are you sure? Internet will drop for ~40-45 seconds.')),
                            E('div', { 'class': 'right' }, [
                                E('button', { 'class': 'btn cbi-button',
                                    'click': ui.hideModal }, _('Cancel')),
                                ' ',
                                E('button', { 'class': 'btn cbi-button cbi-button-reset',
                                    'click': function() {
                                        callReboot();
                                        ui.hideModal();
                                        ui.addNotification(null,
                                            E('p', _('Modem is rebooting...')), 'warning');
                                    }
                                }, _('Reboot'))
                            ])
                        ]);
                    }
                }, _('Reboot Modem')),
            ]),
        ]);

        var watchdogCard = E('div', { 'class': 'rm-card' }, [
            E('h3', {}, _('Automatic Recovery - Connectivity Watchdog')),
            E('table', { 'class': 'rm-table' }, [
                E('tr', {}, [
                    E('td', {}, _('Enabled')),
                    E('td', {}, [ toggleLabel(String(wd.enabled) === '1') ])
                ]),
                E('tr', {}, [
                    E('td', {}, _('Ping host')),
                    E('td', {}, [
                        E('input', { 'type': 'text', 'id': 'wd-host', 'class': 'rm-input',
                            'value': wd.ping_host || '8.8.8.8' })
                    ])
                ]),
                E('tr', {}, [
                    E('td', {}, _('Second ping host')),
                    E('td', {}, [
                        E('input', { 'type': 'text', 'id': 'wd-host2', 'class': 'rm-input',
                            'value': wd.ping_host2 || '1.1.1.1' }),
                        E('div', { 'class': 'rm-hint' },
                            _('Checked only when the ping host fails. If it answers, the connection works and the failure does not count toward the threshold.'))
                    ])
                ]),
                E('tr', {}, [
                    E('td', {}, _('Poll interval')),
                    E('td', {}, [
                        makeSelect('wd-interval', [
                            { v: '5',  l: '5 s' },
                            { v: '10', l: '10 s' },
                            { v: '15', l: '15 s' },
                            { v: '30', l: '30 s' },
                            { v: '60', l: '60 s' }
                        ], curInterval),
                        E('div', { 'class': 'rm-hint' },
                            _('How often to ping. Detection time = interval × threshold.'))
                    ])
                ]),
                E('tr', {}, [
                    E('td', {}, _('Fail threshold')),
                    E('td', {}, [
                        makeSelect('wd-threshold', [ 2, 3, 5, 10 ].map(function(n) {
                            return { v: String(n),
                                l: N_(n, '%d consecutive failure', '%d consecutive failures').format(n) };
                        }), curThresh),
                        E('div', { 'class': 'rm-hint' },
                            _('Example: 10 s × 3 = ~30 s minimum; each failed check can add a few seconds more.'))
                    ])
                ]),
                E('tr', {}, [
                    E('td', {}, _('Recovery action')),
                    E('td', {}, [
                        makeSelect('wd-action', [
                            { v: 'reconnect',     l: ACTION_LABELS['reconnect'] },
                            { v: 'reboot_modem',  l: ACTION_LABELS['reboot_modem'] },
                            { v: 'cascade',       l: ACTION_LABELS['cascade'] },
                            { v: 'reboot_router', l: ACTION_LABELS['reboot_router'] },
                            { v: 'monitor',       l: ACTION_LABELS['monitor'] }
                        ], curAction),
                        E('div', { 'class': 'rm-hint' },
                            _('Cascade escalates one step per threshold hit: reconnect, then reboot modem, then reboot the whole router.'))
                    ])
                ]),
                E('tr', {}, [
                    E('td', {}, _('Event log directory')),
                    E('td', {}, [
                        E('input', { 'type': 'text', 'id': 'wd-logdir', 'class': 'rm-input',
                            'placeholder': '/tmp/rm520n', 'value': wd.log_dir || '' }),
                        E('div', { 'class': 'rm-hint' },
                            _('Empty = RAM only (/tmp/rm520n). Point it at external storage to keep the log across reboots.'))
                    ])
                ]),
                E('tr', {}, [
                    E('td', {}, _('Event log size')),
                    E('td', {}, [
                        makeSelect('wd-events-max', [ 300, 1000, 2000, 5000, 10000 ].map(function(n) {
                            return { v: String(n), l: N_(n, '%d line', '%d lines').format(n) };
                        }), String(wd.events_max || 2000)),
                        E('div', { 'class': 'rm-hint' },
                            _('Oldest lines are dropped beyond this. 2000 lines are roughly 200 KB and usually cover several weeks.'))
                    ])
                ]),
                E('tr', {}, [
                    E('td', {}, _('Serving cell changes')),
                    E('td', {}, [
                        makeSelect('wd-cell-log', [
                            { v: 'stable', l: _('Log stable changes') },
                            { v: 'all',    l: _('Log every change') },
                            { v: 'off',    l: _('Do not log') }
                        ], wd.cell_log || 'stable'),
                        E('div', { 'class': 'rm-hint' },
                            _('Stable: a new primary cell is logged only when it is still there one check (60 s) later. This hides short carrier aggregation swaps.'))
                    ])
                ]),
                E('tr', {}, [
                    E('td', {}, _('Status')),
                    E('td', { 'id': 'wd-status' }, [ statusText(wd) ])
                ]),
                E('tr', {}, [
                    E('td', {}, _('Last successful check')),
                    E('td', { 'id': 'wd-last-ok' }, fmtRelativeTime(wd.last_ok))
                ]),
                E('tr', {}, [
                    E('td', { 'style': 'vertical-align:top' }, _('Recent events')),
                    E('td', { 'id': 'wd-history' }, [ buildHistoryBlock(wd.history) ])
                ]),
            ]),
            E('div', { 'class': 'rm-controls' }, [
                E('button', { 'class': 'rm-btn rm-btn-primary',
                    'click': function() {
                        var enabled   = document.getElementById('wd-enabled').checked ? '1' : '0';
                        var host      = document.getElementById('wd-host').value.trim() || '8.8.8.8';
                        var threshold = document.getElementById('wd-threshold').value;
                        var action    = document.getElementById('wd-action').value;
                        var interval  = document.getElementById('wd-interval').value;
                        var host2     = document.getElementById('wd-host2').value.trim() || '1.1.1.1';
                        var logDir    = document.getElementById('wd-logdir').value.trim();
                        var eventsMax = document.getElementById('wd-events-max').value;
                        var cellLog   = document.getElementById('wd-cell-log').value;
                        callSetConfig(enabled, host, threshold, action, interval, host2, logDir, eventsMax, cellLog).then(function(r) {
                            if (r && r.error) {
                                ui.addNotification(null, E('p', r.error), 'error');
                                return;
                            }
                            return callGetConfig().then(function(fresh) {
                                var w = (fresh && fresh.watchdog) || {};
                                var chk = document.getElementById('wd-enabled');
                                if (chk) chk.checked = String(w.enabled) === '1';
                                var h = document.getElementById('wd-host');
                                if (h) h.value = w.ping_host || '8.8.8.8';
                                var h2 = document.getElementById('wd-host2');
                                if (h2) h2.value = w.ping_host2 || '1.1.1.1';
                                var ld = document.getElementById('wd-logdir');
                                if (ld) ld.value = w.log_dir || '';
                                var em = document.getElementById('wd-events-max');
                                if (em) em.value = String(w.events_max || 2000);
                                var cl = document.getElementById('wd-cell-log');
                                if (cl) cl.value = w.cell_log || 'stable';
                                var thr = document.getElementById('wd-threshold');
                                if (thr) thr.value = String(w.fail_threshold || 3);
                                var act = document.getElementById('wd-action');
                                if (act) act.value = w.action || 'reboot_modem';
                                var ivl = document.getElementById('wd-interval');
                                if (ivl) ivl.value = String(w.interval || 10);
                                var st = document.getElementById('wd-status');
                                if (st) {
                                    while (st.firstChild) st.removeChild(st.firstChild);
                                    st.appendChild(statusText(w));
                                }
                                var lo = document.getElementById('wd-last-ok');
                                if (lo) lo.textContent = fmtRelativeTime(w.last_ok);
                                var hi = document.getElementById('wd-history');
                                if (hi) {
                                    while (hi.firstChild) hi.removeChild(hi.firstChild);
                                    hi.appendChild(buildHistoryBlock(w.history));
                                }
                                ui.addNotification(null,
                                    E('p', _('Saved - enabled: %s, host: %s, second host: %s, every: %ss, threshold: %s, action: %s').format(
                                        String(w.enabled) === '1' ? _('yes') : _('no'),
                                        w.ping_host || '8.8.8.8', w.ping_host2 || '1.1.1.1',
                                        w.interval || 10, w.fail_threshold || 3, w.action || 'reboot_modem')),
                                    'info');
                                return refreshEvents();
                            });
                        });
                    }
                }, _('Save')),
                E('button', { 'class': 'rm-btn rm-btn-default',
                    'click': function() {
                        callGetConfig().then(function(fresh) {
                            var w = (fresh && fresh.watchdog) || {};
                            var st = document.getElementById('wd-status');
                            if (st) {
                                while (st.firstChild) st.removeChild(st.firstChild);
                                st.appendChild(statusText(w));
                            }
                            var lo = document.getElementById('wd-last-ok');
                            if (lo) lo.textContent = fmtRelativeTime(w.last_ok);
                            var hi = document.getElementById('wd-history');
                            if (hi) {
                                while (hi.firstChild) hi.removeChild(hi.firstChild);
                                hi.appendChild(buildHistoryBlock(w.history));
                            }
                        });
                        refreshEvents();
                    }
                }, _('Refresh Status')),
            ]),
        ]);

        var eventsCard = E('div', { 'class': 'rm-card' }, [
            E('h3', {}, _('Connection Log')),
            E('div', { 'class': 'rm-hint', 'style': 'margin:0 0 10px' },
                _('Written by the watchdog: outages classified by what was still reachable, recovery actions, and serving cell changes (checked every 60 s).')),
            E('div', { 'id': 'wd-events' }, [ buildEventsBlock(events) ]),
            E('div', { 'class': 'rm-controls' }, [
                E('button', { 'class': 'rm-btn rm-btn-default',
                    'click': function() { refreshEvents(); }
                }, _('Refresh Log'))
            ])
        ]);

        return E('div', { 'id': 'rm520n-view' }, [
            E('style', {}, CSS),
            watchdogCard,
            eventsCard,
            actionsCard,
        ]);
    },

    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});
