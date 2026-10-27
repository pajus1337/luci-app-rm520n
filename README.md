# luci-app-rm520n

> LuCI web panel for **Quectel RM520NGL 5G modem** management on OpenWrt 25.12.
> Provides real-time signal monitoring, band locking, APN configuration, and modem diagnostics - directly in your router's web interface.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![OpenWrt](https://img.shields.io/badge/OpenWrt-25.12-blue.svg)](https://openwrt.org)

---

## Overview

When the RM520NGL modem operates in **PCIe/GbE mode** (via the Waveshare carrier board), OpenWrt treats the connection as a plain Ethernet WAN - the modem is invisible to LuCI. This app fills that gap by communicating with the modem directly over its **USB AT command port** (`/dev/ttyUSB2`) and exposing a rich management panel in the LuCI web interface.

**Companion project:** [gl-mt6000-rm520n-auto-config](https://github.com/pajus1337/gl-mt6000-rm520n-auto-config) - the installer that sets up the GbE data path this app is designed to complement.

---

## Features

- **Signal dashboard** - RSRP bar chart with colour coding, RSSI, SINR, RSRQ; auto-refreshed every 10 s
- **Signal quality badge** - combined RSRP + SINR score: Poor / Fair / Good / Very Good / Excellent
- **Technology badge** - live indicator: `LTE`, `NR5G-NSA`, `NR5G-SA`
- **Modem info** - firmware version, IMEI, LTE and 5G NR registration status, operator, MCC/MNC
- **Cell Info** - RRC state, band, duplex, EARFCN, PCI, TAC; fallbacks from QNWINFO/QCAINFO/CEREG for NOCONN mode
- **Cell ID block** - hex + decimal ECI, decoded eNB ID and sector, direct **CellMapper** deep-link
- **Carrier Aggregation** - lists PCC/SCC with band, EARFCN, PCI, RSRP per component carrier
- **Per-antenna RSRP** - RX0-RX3 individual signal levels with colour coding
- **Temperature panel** - all active modem sensors with colour-coded values (green / amber / orange / red)
- **Data counters** - modem-side TX/RX byte totals via `AT+QGDCNT?`
- **SMS inbox** - messages stored on the modem, decoded in the browser (GSM 7-bit, UCS2, multipart messages joined), with delete
- **USSD** - send a code such as a balance check and read the answer, including replies inside USSD menus
- **Band configuration** - toggle chip buttons per LTE/NR band, All/None shortcuts, Apply per RAT, Reset All Bands
- **Network mode** - switch between AUTO / LTE / NR5G / LTE:NR5G
- **APN configuration** - change APN without touching UCI
- **Reconnect** - soft reconnect (CFUN=4 → CFUN=1, ~5 s downtime) with confirmation dialog
- **Modem reboot** - full restart (CFUN=1,1, ~20 s) with confirmation dialog
- **Connectivity watchdog** - procd daemon pings a configurable host; on repeated failure runs reconnect, modem reboot, a 3-stage cascade (reconnect → reboot modem → reboot router), or a router reboot outright, or only monitors. Tools shows live status, time since last successful check, and a scrollable event history (with a signal snapshot logged at each action) so failures can be correlated with signal quality
- **Connection log** - every outage is classified by what was still reachable (modem/board, mobile data, or only the ping host), with its duration, the serving cell at that moment, recovery actions and serving cell changes; 24 h summary on the Tools page

---

## Requirements

- OpenWrt **25.12** or later
- Quectel **RM520NGL** connected via Waveshare 5G M.2 to GbE carrier board
- USB 3.1 cable from Waveshare board to router USB port (provides `/dev/ttyUSBx`)
- LuCI installed (`luci-base`)

> This app works independently of how the modem's data path is configured (GbE or USB). It only needs the AT command port on `/dev/ttyUSB2`.

---

## Installation

**Option A - One-liner (wget, available on all OpenWrt installs):**
```sh
wget -qO- https://raw.githubusercontent.com/pajus1337/luci-app-rm520n/main/install.sh | sh
```

**Option B - Clone and run locally:**
```sh
cd /root
git clone https://github.com/pajus1337/luci-app-rm520n.git
cd luci-app-rm520n
sh install.sh
```

The installer copies files directly to the router filesystem - no OpenWrt build system required.

After installation, open LuCI and navigate to:
**Network → 5G Modem (RM520N)**

**Uninstall** (stops the watchdog and removes the panel; settings in `/etc/config/rm520n` are kept):
```sh
sh install.sh --uninstall
# or
wget -qO- https://raw.githubusercontent.com/pajus1337/luci-app-rm520n/main/install.sh | sh -s -- --uninstall
```

---

## Architecture

```
LuCI browser (JavaScript view)
        │
        │ JSON-RPC / ubus
        ▼
  rpcd daemon
        │
        │ calls
        ▼
/usr/libexec/rpcd/rm520n   (shell script backend)
        │
        │ AT commands (exec 3<>/dev/ttyUSB2)
        ▼
  RM520NGL modem  ←──  USB 3.1  ──  Waveshare board
```

**Key files:**

| File | Description |
|---|---|
| `root/usr/libexec/rpcd/rm520n` | Shell script backend - handles JSON-RPC calls, queries modem via AT |
| `htdocs/.../view/rm520n/overview.js` | LuCI JavaScript view - cards, signal bars, controls, auto-refresh |
| `htdocs/.../view/rm520n/messages.js` | LuCI JavaScript view - SMS inbox (PDU decoding) and USSD |
| `htdocs/.../view/rm520n/tools.js` | LuCI JavaScript view - watchdog configuration and status, connection log, manual reconnect/reboot |
| `htdocs/.../view/rm520n/settings.js` | LuCI JavaScript view - band configuration, network mode, APN |
| `root/usr/sbin/rm520n-watchdog` | Connectivity watchdog daemon (procd-managed) |
| `root/etc/init.d/rm520n-watchdog` | procd init script for the watchdog daemon |
| `root/usr/share/luci/menu.d/rm520n.json` | Registers the page under Network menu |
| `root/usr/share/rpcd/acl.d/rm520n.json` | rpcd access control list |
| `po/` | Translation template (`templates/rm520n.pot`) and catalogs (`de`, `pl`, `zh_Hans`) |

---

## Translations

The UI is written in English. German and Polish catalogs are complete, Simplified Chinese is
partial. LuCI shows a translation only when the matching LuCI language is installed and selected
(`luci-i18n-base-de`, `luci-i18n-base-pl`, ...); otherwise everything stays in English.

The catalogs are compiled to `.lmo` files when the package is built with the OpenWrt SDK
(`luci-i18n-rm520n-<lang>`). `install.sh` does not install translations yet.

To add or update a language, regenerate `po/templates/rm520n.pot` from the sources (LuCI's
`build/i18n-scan.pl`) and merge it into `po/<lang>/rm520n.po`. Keep `%s`/`%d` placeholders as
they are.

---

## Available rpcd Methods

| Method | Type | Description |
|---|---|---|
| `full_status` | read | All modem data in one call - used on page load |
| `refresh` | read | Fast refresh: signal, cell info, CA, per-antenna RSRP (10 s poll) |
| `bands` | read | Current LTE/NR band masks and mode preference |
| `set_bands` | write | Lock to specific LTE and/or NR bands (`AT+QNWPREFCFG`) |
| `reset_bands` | write | Restore all LTE and NR bands to factory defaults |
| `set_mode` | write | Set network mode preference (AUTO/LTE/NR5G/LTE:NR5G) |
| `set_apn` | write | Set PDP context APN (`AT+CGDCONT`) |
| `reconnect` | write | Soft reconnect: CFUN=4, sleep 3 s, CFUN=1 |
| `reboot_modem` | write | Full modem restart (`AT+CFUN=1,1`) |
| `reset_counters` | write | Reset modem data counters (`AT+QGDCNT=0,0`) |
| `get_config` | read | Watchdog config, status, last successful check, event history |
| `set_config` | write | Update watchdog config (hosts, interval, threshold, action, log directory) and (re)start the daemon |
| `get_events` | read | Connection log written by the watchdog (outages, actions, cell changes) |
| `sms_list` | read | Raw PDUs of the stored messages (`AT+CMGL=4`) and storage usage; marks unread messages as read |
| `sms_delete` | write | Delete messages by storage index (`AT+CMGD`) |
| `ussd` | write | Send a USSD code or menu reply (`AT+CUSD=1`) and return the network's answer |
| `ussd_cancel` | write | End an open USSD session (`AT+CUSD=2`) |

---

## Connectivity Watchdog

A procd-managed daemon (`root/usr/sbin/rm520n-watchdog`) pings a configurable host at a fixed
interval and counts consecutive failures. Once the failure threshold is reached it runs one of:

| Action | Effect |
|---|---|
| `reconnect` | Soft reconnect (CFUN=4 → 1) |
| `reboot_modem` | Full modem restart (`AT+CFUN=1,1`) |
| `cascade` | Escalates one stage per threshold hit: reconnect → reboot modem → reboot router |
| `reboot_router` | Full OpenWrt reboot |
| `monitor` | No action, only the connection log below |

Detection time is `interval × threshold` at minimum (e.g. 10 s × 3 = ~30 s) - a little more under
packet loss, since each failed check itself waits on ping timeouts. Every triggered action is
logged via syslog with a one-line signal snapshot (technology, RSRP, SINR, RRC state, supply
voltage, traffic since the last snapshot, per-SCC signal, and local gateway reachability)
captured at that moment, so repeated events can be correlated with signal quality - and with
whether the modem itself was still reachable - rather than just timestamps.

If the modem's AT port or the `rm520n` rpcd object is missing when the threshold is reached
(for example right after a firmware upgrade, before the USB serial driver is reinstalled), the
watchdog logs this once and skips the action instead of escalating. That includes
`reboot_router`, since a router reboot cannot restore a missing driver. Monitoring continues, and
actions resume as soon as the port is back.

Configure it under **Network → 5G Modem (RM520N) → Tools**, where you can also see time since
the last successful check and a scrollable history of recent watchdog events.

### Connection log

When a check fails, the watchdog also pings the local gateway and a second host (default
`1.1.1.1`) to classify the failure:

| Verdict | Meaning |
|---|---|
| Modem/board unreachable | The gateway (modem side of the GbE link) does not answer |
| No default route | WAN has no default route, e.g. DHCP lease lost |
| Mobile data down | Gateway answers, both hosts do not |
| Only primary host unreachable | The second host answers, so the connection works |

The last case is logged but does not count toward the failure threshold, since no recovery action
could fix it. Outages (start, verdict, serving cell, duration), recovery actions and serving cell
changes (checked every 60 s) are written to `/tmp/rm520n/events.log` (last 300 events, in RAM).
Set **Event log directory** to a path on external storage to keep the log across reboots. The
Tools page shows a 24 h summary and the latest events. Pick the `monitor` action to get only the
log, with no automatic recovery.

## Signal Quality Reference

| Metric | Excellent | Very Good | Good | Fair | Poor |
|---|---|---|---|---|---|
| RSRP | > −80 dBm | > −90 dBm | > −100 dBm | > −110 dBm | ≤ −110 dBm |
| SINR (modifier) | - | - | +1 score if ≥ 10 dB | - | −1 score if < 0 dB |
| RSRQ (display) | > −10 dB | > −15 dB | > −20 dB | ≤ −20 dB | - |

The badge score (1-5) is RSRP-based, then adjusted ±1 by SINR.

---

## Troubleshooting

**Panel shows no data / AT port not found:**
```sh
ls /dev/ttyUSB*
# If missing, check that USB cable from Waveshare is connected to router USB port
# and that kmod-usb-serial-option is installed
```

**Test AT communication manually:**
```sh
stty -F /dev/ttyUSB2 -opost -onlcr -icrnl min 0 time 3
exec 3<>/dev/ttyUSB2
printf 'AT\r\n' >&3
dd <&3 bs=4096 count=1 2>/dev/null
exec 3>&-
# Should output: OK
```

**Reload rpcd after manual file changes:**
```sh
/etc/init.d/rpcd reload
rm -rf /tmp/luci-indexcache /tmp/luci-modulecache
```

**Band/EARFCN show `-` in Cell Info:**
The modem enters `NOCONN` state on the AT port when data runs over PCIe/GbE. `AT+QENG="servingcell"` returns no cell data in this state. The app falls back to `AT+QNWINFO` (band/EARFCN) and `AT+QCAINFO` (PCI) automatically.

**`wwan_mgmt` shows "Absent" / disconnected in LuCI → Network → Interfaces:**
Expected - this app doesn't use that interface at all. It talks to the modem over the AT/USB port directly, not QMI. If you installed the companion [gl-mt6000-rm520n-auto-config](https://github.com/pajus1337/gl-mt6000-rm520n-auto-config) installer, see its README Troubleshooting section for why that interface exists and why it's never connected.

---

## Compatibility

| Component | Tested version |
|---|---|
| OpenWrt | 25.12.3, 25.12.6 |
| Modem firmware | RM520NGLAAR03A03M4G |
| LuCI | 26.x (OpenWrt 25.12 default) |

> **Firmware upgrades:** `install.sh` adds the panel files to `/etc/sysupgrade.conf`, so they and
> `/etc/config/rm520n` survive a `sysupgrade` with "keep settings", with or without extroot.
> A stock image does not include `coreutils-stty` or the modem's USB serial driver, so after the
> upgrade reinstall them: `apk update && apk add coreutils-stty kmod-usb-serial-option`. The watchdog is intentionally left stopped until you start it, because without the AT
> port it could only escalate blindly: `/etc/init.d/rm520n-watchdog enable && /etc/init.d/rm520n-watchdog start`.

---

## Related Projects

- [gl-mt6000-rm520n-auto-config](https://github.com/pajus1337/gl-mt6000-rm520n-auto-config) - Automated installer for the full GbE modem setup on GL-MT6000

---

## License

[MIT](LICENSE) © 2026 pajus1337
