/* Sri Sai Speciality Dental Care — billing app. Split from the original single index.html. */
    // ════════════════════════════════════════════════════════════
    // BLUETOOTH THERMAL PRINTER ENGINE
    // ════════════════════════════════════════════════════════════
    window._btPrinter = {
        device: null,
        server: null,
        characteristic: null,
        connected: false,
        deviceName: '',
        autoPrintAfterConnect: false
    };

    // Common BLE printer service/characteristic UUID sets (try each in order)
    var BT_PROFILES = [
        { service: '000018f0-0000-1000-8000-00805f9b34fb', char: '00002af1-0000-1000-8000-00805f9b34fb' },
        { service: 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', char: 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f' },
        { service: '49535343-fe7d-4ae5-8fa9-9fafd205e455', char: '49535343-1e4d-4bd9-ba61-23c647249616' },
        { service: '0000ff00-0000-1000-8000-00805f9b34fb', char: '0000ff02-0000-1000-8000-00805f9b34fb' },
        { service: '000018f0-0000-1000-8000-00805f9b34fb', char: '00002af0-0000-1000-8000-00805f9b34fb' }
    ];

    function openBtPrinterPanel(autoPrint) {
        window._btPrinter.autoPrintAfterConnect = !!autoPrint;
        var panel = document.getElementById('__btPanel');
        if (panel) {
            panel.style.display = 'flex';
            requestAnimationFrame(function(){
                var sheet = document.getElementById('__btPanelSheet');
                if(sheet) sheet.style.transform = 'translateY(0)';
            });
        }
        _btUpdateUI();
    }

    function closeBtPrinterPanel() {
        var panel = document.getElementById('__btPanel');
        var sheet = document.getElementById('__btPanelSheet');
        if(sheet) sheet.style.transform = 'translateY(110%)';
        setTimeout(function(){ if(panel) panel.style.display = 'none'; }, 340);
    }

    function _btSetStatus(msg, type) {
        var el = document.getElementById('__btStatusMsg');
        if (!el) return;
        if (msg) {
            el.textContent = msg;
            el.className = '__btStatus ' + (type || 'info');
            el.style.display = 'block';
        } else {
            el.style.display = 'none';
        }
    }

    function _btSetProgress(show) {
        var el = document.getElementById('__btProgressWrap');
        if (el) el.style.display = show ? 'block' : 'none';
    }

    function _btUpdateUI() {
        var connected = window._btPrinter.connected;
        var name = window._btPrinter.deviceName || 'Thermal Printer';

        // Sidebar indicator
        var dot = document.getElementById('btStatusDot');
        var lbl = document.getElementById('btPrinterLabel');
        if (dot) { dot.style.background = connected ? '#27ae60' : '#e74c3c'; dot.style.animation = connected ? 'none' : 'pulse 2s infinite'; }
        if (lbl) lbl.textContent = connected ? name : 'Thermal Printer';

        // Panel cards
        var connCard = document.getElementById('__btConnectedCard');
        var notConn  = document.getElementById('__btNotConnectedSection');
        var printNow = document.getElementById('__btPrintNowSection');
        var nameEl   = document.getElementById('__btConnName');
        if (nameEl) nameEl.textContent = name;
        if (connCard) connCard.style.display = connected ? 'block' : 'none';
        if (notConn)  notConn.style.display  = connected ? 'none' : 'block';
        if (printNow) printNow.style.display  = (connected && window._btPrinter.autoPrintAfterConnect && __pendingPrintHtml) ? 'block' : 'none';

        // Print choice button
        var btBtn = document.getElementById('__pcdBtBtn');
        if (btBtn) {
            if (connected) {
                btBtn.innerHTML = '🔵 Thermal Print<br><span style="font-size:11px;opacity:0.85;">80mm · '+name+'</span>';
                btBtn.style.opacity = '1';
            } else {
                btBtn.innerHTML = '🔵 Thermal Print<br><span style="font-size:11px;opacity:0.85;">Tap to connect first</span>';
                btBtn.style.opacity = '0.75';
            }
        }
    }

    async function btScanAndConnect() {
        if (!navigator.bluetooth) {
            _btSetStatus('❌ Web Bluetooth not supported. Use Chrome/Edge on Android or Chrome on Desktop.', 'err');
            return;
        }
        _btSetStatus('🔍 Opening Bluetooth scanner...', 'info');
        _btSetProgress(true);
        try {
            // Build optionalServices list from all profiles
            var optServices = BT_PROFILES.map(function(p){ return p.service; });
            var device = await navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices: optServices
            });
            _btSetStatus('⏳ Connecting to ' + device.name + '...', 'info');
            window._btPrinter.device     = device;
            window._btPrinter.deviceName = device.name || 'BT Printer';
            device.addEventListener('gattserverdisconnected', _btOnDisconnected);

            var server = await device.gatt.connect();
            window._btPrinter.server = server;

            // Try each profile until one works
            var char = null;
            for (var i = 0; i < BT_PROFILES.length; i++) {
                try {
                    var svc = await server.getPrimaryService(BT_PROFILES[i].service);
                    char = await svc.getCharacteristic(BT_PROFILES[i].char);
                    break;
                } catch(e2) { /* try next */ }
            }
            if (!char) {
                // Fallback: try to get any writable characteristic
                try {
                    var services = await server.getPrimaryServices();
                    outer: for (var s = 0; s < services.length; s++) {
                        var chars = await services[s].getCharacteristics();
                        for (var c = 0; c < chars.length; c++) {
                            var props = chars[c].properties;
                            if (props.write || props.writeWithoutResponse) {
                                char = chars[c]; break outer;
                            }
                        }
                    }
                } catch(e3) {}
            }
            if (!char) throw new Error('No writable characteristic found on this printer. Try pairing it in Bluetooth settings first.');

            window._btPrinter.characteristic = char;
            window._btPrinter.connected = true;
            _btSetProgress(false);
            _btSetStatus('✅ Connected to ' + device.name, 'ok');
            _btUpdateUI();
            showToast('🔵 Printer connected: ' + device.name, 'success');

            // Auto-print if triggered from print dialog
            if (window._btPrinter.autoPrintAfterConnect && __pendingPrintHtml) {
                window._btPrinter.autoPrintAfterConnect = false;
                _btUpdateUI();
                setTimeout(function(){ _doThermalPrint(__pendingPrintHtml); closeBtPrinterPanel(); }, 600);
            }
        } catch(err) {
            _btSetProgress(false);
            if (err.name === 'NotFoundError' || err.message.includes('cancelled')) {
                _btSetStatus('', '');
            } else {
                _btSetStatus('❌ ' + err.message, 'err');
            }
        }
    }

    function _btOnDisconnected() {
        window._btPrinter.connected = false;
        window._btPrinter.characteristic = null;
        _btUpdateUI();
        if (document.getElementById('__btPanel').style.display === 'flex') {
            _btSetStatus('⚠️ Printer disconnected. Tap Scan to reconnect.', 'err');
        }
        showToast('🔌 Bluetooth printer disconnected', 'warning');
    }

    function btDisconnect() {
        if (window._btPrinter.device && window._btPrinter.device.gatt.connected) {
            window._btPrinter.device.gatt.disconnect();
        }
        window._btPrinter.connected = false;
        window._btPrinter.characteristic = null;
        _btUpdateUI();
        _btSetStatus('', '');
    }

    // ── ESC/POS Receipt Builder — 80mm / 3.1" (W=48) ─────────
    var ESC=0x1B, GS=0x1D, LF=0x0A;
    // Printer character width — KP307 default is 42. Change in printer panel if misaligned.
    var _W = parseInt(localStorage.getItem('thermal_printer_width') || '48');

    function _init()   { return [ESC,0x40]; }
    function _fontA()  { return [ESC,0x4D,0x00]; }
    function _aL()     { return [ESC,0x61,0x00]; }
    function _aC()     { return [ESC,0x61,0x01]; }
    function _bOn()    { return [ESC,0x45,0x01]; }
    function _bOff()   { return [ESC,0x45,0x00]; }
    function _gap(n)   { return [ESC,0x33,n|0]; }
    function _cut()    { return [GS, 0x56,0x41,0x20]; }
    function _lf(n)    { var r=[]; for(var i=0;i<(n||1);i++) r.push(LF); return r; }
    // Double-height + double-width (tall + wide = big text)
    function _tallOn()  { return [ESC,0x21,0x30]; } // bit4=dblH, bit5=dblW, bold
    function _tallOff() { return [ESC,0x21,0x00]; }
    // Double-height only (taller but same width — fits more chars)
    // ESC ! 0x10 = double height; works on virtually all ESC/POS printers
    function _dhOn()    { return [ESC,0x21,0x10]; }
    function _dhOff()   { return [ESC,0x21,0x00]; }

    function _clean(s){
        return (s||'')
            .replace(/&#8377;/g,'Rs.').replace(/\u20b9/g,'Rs.')
            .replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/\u00a0/g,' ')
            .replace(/&lt;/g,'<').replace(/&gt;/g,'>')
            .replace(/\u2014|\u2013/g,'-')
            .replace(/[^\x20-\x7E\n]/g,'');
    }
    function _b(s){
        var c=_clean(s),o=[];
        for(var i=0;i<c.length;i++) o.push(c.charCodeAt(i)&0xFF);
        return o;
    }
    function _t(s,w){ return _clean(String(s||'')).substring(0,w||_W); }

    // Center within W
    function _ctr(s,w){
        var W=w||_W, t=_clean(String(s||''));
        if(t.length>=W) t=t.substring(0,W);
        var p=Math.floor((W-t.length)/2);
        return _b(' '.repeat(p)+t+'\n');
    }

    // Center at DOUBLE-WIDTH (max 24 chars visible)
    function _ctrDW(s){
        var W=24, t=_clean(String(s||'')).substring(0,W);
        var p=Math.floor((W-t.length)/2);
        return _b(' '.repeat(p)+t+'\n');
    }

    // Dash leader right-justify: "LEFT ---- RIGHT\n"
    function _dash(left,right,w){
        var W=w||_W;
        left=_clean(String(left||'')); right=_clean(String(right||''));
        var sp=W-left.length-right.length;
        if(sp<2){ left=left.substring(0,W-right.length-2); sp=2; }
        return _b(left+'-'.repeat(sp)+right+'\n');
    }

    // Parse amount
    function _amt(s){
        var m=_clean(String(s||'')).match(/(\d[\d,]*\.?\d*)/);
        return m?parseFloat(m[1].replace(/,/g,'')):0;
    }
    function _n(s){ var v=_amt(s); return v>0?v.toFixed(2):''; }

    // Dividers — 48 chars wide
    function _div()  { return _b('------------------------------------------------\n'); }
    function _dbl()  { return _b('================================================\n'); }
    function _dot()  { return _b('................................................\n'); }
    function _star() { return _b('================================================\n'); }
    function _nl()   { return [LF]; }

    // ── UPI QR Code ───────────────────────────────────────────
    function _upiQR(upiId,amount,name,ms){
        var url='upi://pay?pa='+upiId+'&pn='+(name||'SriSaiDental')+
                '&am='+amount.toFixed(2)+'&cu=INR&tn=DentalBill';
        var data=[]; for(var i=0;i<url.length;i++) data.push(url.charCodeAt(i)&0xFF);
        var sLen=data.length+3, pL=sLen&0xFF, pH=(sLen>>8)&0xFF;
        return [].concat(
            [GS,0x28,0x6B,0x04,0x00,0x31,0x41,0x32,0x00],
            [GS,0x28,0x6B,0x03,0x00,0x31,0x43,ms||4],
            [GS,0x28,0x6B,0x03,0x00,0x31,0x45,0x31],
            [GS,0x28,0x6B,pL,pH,0x31,0x50,0x30],
            data,
            [GS,0x28,0x6B,0x03,0x00,0x31,0x51,0x30]
        );
    }

    // ════════════════════════════════════════════════════════
    //  MAIN BUILDER
    // ════════════════════════════════════════════════════════
    function _buildThermalBytes(html){
        html=html.replace(/&#8377;/g,'Rs.').replace(/\u20b9/g,'Rs.')
                 .replace(/&amp;/g,'&').replace(/&nbsp;/g,' ')
                 .replace(/&lt;/g,'<').replace(/&gt;/g,'>');

        var doc=(new DOMParser()).parseFromString(html,'text/html');
        var out=[], grandTotal=0;

        out=out.concat(_init());
        out=out.concat(_fontA());
        out=out.concat([ESC,0x21,0x00]);  // ensure normal mode
        out=out.concat(_gap(24));

        // ════════════════════════════════════
        //  HEADER
        // ════════════════════════════════════
        out=out.concat(_aC());
        // Clinic name: Double-height + bold (fits 48 chars wide, taller)
        out=out.concat(_dhOn());
        out=out.concat(_bOn());
        out=out.concat(_ctr('SRI SAI SPECIALITY DENTAL CARE'));
        out=out.concat(_bOff());
        out=out.concat(_dhOff());
        // Tagline — normal bold
        out=out.concat([ESC,0x21,0x00]);
        out=out.concat(_bOn());
        out=out.concat(_ctr('~ Smile With Confidence ~'));
        out=out.concat(_bOff());
        out=out.concat(_star());
        out=out.concat(_bOn());
        out=out.concat(_ctr('TKR College Rd, Karmanghat'));
        out=out.concat(_ctr('Ph: 9396522492 / 8688033072'));
        out=out.concat(_bOff());
        out=out.concat(_star());
        out=out.concat(_aL());

        var isCB=!!doc.getElementById('__cb');
        var isRx=!!doc.getElementById('__rx');
        var isPh=!!doc.getElementById('__ph');

        // ════════════════════════════════════
        //  COMBINED BILL
        // ════════════════════════════════════
        if(isCB){
            var cb=doc.getElementById('__cb');
            var iv=Array.from(cb?cb.querySelectorAll('.i-val'):[])
                       .map(function(e){return _clean(e.textContent.replace(/\u00a0/g,' ').trim());});

            if(iv[0]) { out=out.concat(_bOn()); out=out.concat(_b('Bill No : '+_t(iv[0],40)+'\n')); out=out.concat(_bOff()); }
            if(iv[1]) out=out.concat(_b('Date    : '+_t(iv[1],38)+'\n'));
            if(iv[2]) out=out.concat(_b('Patient : '+_t(iv[2],38)+'\n'));
            if(iv[3]) out=out.concat(_b('Doctor  : '+_t(iv[3],38)+'\n'));
            if(iv[4]) out=out.concat(_b('Phone   : '+_t(iv[4],38)+'\n'));
            out=out.concat(_div());

            // ── Medicines ──────────────────────────────────
            var mTable=cb?cb.querySelector('table.meds'):null, meds=[];
            if(mTable){ Array.from(mTable.querySelectorAll('tbody tr')).forEach(function(row){
                var td=Array.from(row.querySelectorAll('td'))
                          .map(function(c){return _clean(c.textContent.trim());});
                if(td.length<2||!td[0]||/no medicines/i.test(td[0]))return;
                meds.push({name:td[0],qty:td[1]||'',rate:td[2]||'',amount:td[td.length-1]});
            });}

            if(meds.length>0){
                out=out.concat(_aC());
                out=out.concat(_bOn());
                out=out.concat(_ctr('- MEDICINES -'));
                out=out.concat(_bOff());
                out=out.concat(_aL());
                out=out.concat(_dot());
                out=out.concat(_bOn());
                out=out.concat(_b('  Item              Qty   Rate     Amount\n'));
                out=out.concat(_bOff());
                out=out.concat(_dot());

                meds.forEach(function(m){
                    var aStr = _n(m.amount);
                    var left = _t(m.name,16);
                    if(m.qty)  left += ' x'+_t(m.qty,3);
                    if(m.rate) left += ' @'+_t(m.rate,9);
                    left = _t(left, _W - aStr.length - 3);
                    out=out.concat(_dash(left, aStr));
                });
                out=out.concat(_dot());
            }

            // ── Summary rows ────────────────────────────────
            var sBox=cb?cb.querySelector('.summary-box'):null, sRows=[];
            if(sBox){ Array.from(sBox.querySelectorAll('tr')).forEach(function(row){
                var td=Array.from(row.querySelectorAll('td'))
                          .map(function(c){return _clean(c.textContent.trim());});
                if(td.length>=2&&td[0]&&td[1]) sRows.push({label:td[0],value:td[1]});
            });}

            sRows.slice(0,-1).forEach(function(r){
                var v=_amt(r.value);
                var valStr='Rs.'+v.toFixed(2);
                out=out.concat(_bOn());
                out=out.concat(_dash(_t(r.label,24),valStr));
                out=out.concat(_bOff());
            });

            // Grand Total — TALL + BOLD
            var gRow=sRows.length>0?sRows[sRows.length-1]:null;
            if(gRow){
                grandTotal=_amt(gRow.value);
                out=out.concat(_dbl());
                out=out.concat(_aC());
                out=out.concat(_tallOn());
                out=out.concat(_ctrDW('GRAND TOTAL'));
                out=out.concat(_ctrDW('Rs.'+grandTotal.toFixed(2)));
                out=out.concat(_tallOff());
                out=out.concat(_aL());
                out=out.concat(_dbl());
            }

            // ── Treatment-only (no medicines) ──
            var trEl=cb?cb.querySelector('.tr-amt-row'):null, trAmt=0;
            if(trEl&&meds.length===0){
                var tm=_clean(trEl.textContent).match(/(\d[\d,]*\.?\d*)/);
                trAmt=tm?parseFloat(tm[1].replace(/,/g,'')):0;
                var trBox=cb?cb.querySelector('.tr-box'):null, trLines=[];
                if(trBox){ trBox.querySelectorAll('div').forEach(function(d){
                    var t=_clean(d.textContent.trim()); if(t&&t.length>1)trLines.push(t);
                });}
                trLines.slice(0,4).forEach(function(l){ out=out.concat(_b(_t(l,_W)+'\n')); });
                if(trAmt>0){
                    grandTotal=trAmt;
                    out=out.concat(_dbl());
                    out=out.concat(_aC());
                    out=out.concat(_dhOn());
                    out=out.concat(_ctr('** GRAND TOTAL **'));
                    out=out.concat(_ctr('Rs. '+grandTotal.toFixed(2)));
                    out=out.concat(_dhOff());
                    out=out.concat(_aL());
                    out=out.concat(_dbl());
                }
            }

        } else if(doc.getElementById('__tr')) {
            // ── TREATMENT RECEIPT (#__tr) ──────────────────
            var tr = doc.getElementById('__tr');
            var iVals = Array.from(tr?tr.querySelectorAll('.i-val'):[])
                            .map(function(e){return _clean(e.textContent.replace(/\u00a0/g,' ').replace(/&nbsp;/g,' ').trim());});
            var trNo   = iVals[0]||'';
            var trDate = iVals[1]||'';
            var trPt   = iVals[2]||'';
            var trAmt2 = iVals[3]||'';
            var trWords= iVals[4]||'';
            var trRows = Array.from(tr?tr.querySelectorAll('table.treat td.item-cell'):[])
                             .map(function(td){return _clean(td.textContent.trim());})
                             .filter(function(t){return t&&t.length>1;});
            grandTotal = parseFloat(trAmt2.replace(/[^\d.]/g,''))||0;

            if(trNo)  { out=out.concat(_bOn()); out=out.concat(_b('Bill No : '+_t(trNo,39)+'\n')); out=out.concat(_bOff()); }
            if(trDate)  out=out.concat(_b('Date    : '+_t(trDate,38)+'\n'));
            if(trPt)    out=out.concat(_b('Patient : '+_t(trPt,38)+'\n'));
            if(trAmt2)  out=out.concat(_b('Amount  : Rs.'+_t(trAmt2,35)+'\n'));
            if(trWords) out=out.concat(_b('Words   : '+_t(trWords,38)+'\n'));
            out=out.concat(_div());

            if(trRows.length>0){
                out=out.concat(_bOn());
                out=out.concat(_b('TOWARDS:\n'));
                out=out.concat(_bOff());
                out=out.concat(_aC());
                out=out.concat(_bOn());
                trRows.forEach(function(l){ out=out.concat(_ctr(l.trim())); });
                out=out.concat(_bOff());
                out=out.concat(_aL());
                out=out.concat(_nl());
            }

            if(grandTotal>0){
                out=out.concat(_dbl());
                out=out.concat(_aC());
                out=out.concat(_tallOn());
                out=out.concat(_ctrDW('TOTAL'));
                out=out.concat(_ctrDW('Rs.'+grandTotal.toFixed(2)));
                out=out.concat(_tallOff());
                out=out.concat(_aL());
                out=out.concat(_dbl());
            }

        } else if(isRx){
            var rx=doc.getElementById('__rx');
            _clean(rx?(rx.innerText||rx.textContent):'').split('\n')
                .map(function(l){return l.trim();}).filter(Boolean).slice(0,30)
                .forEach(function(l){
                    if(/^(sri sai|mob|timing|reg\.|b\.d)/i.test(l))return;
                    out=out.concat(_b(_t(l,_W)+'\n'));
                });

        } else if(doc.getElementById('__ph')) {
            // ════════════════════════════════════
            //  PHARMACY BILL (direct data path)
            // ════════════════════════════════════
            var ph = doc.getElementById('__ph');
            var phBillId  = ph.getAttribute('data-billid')  || '';
            var phPatient = ph.getAttribute('data-patient')  || '';
            var phDoctor  = ph.getAttribute('data-doctor')   || '';
            var phDate    = ph.getAttribute('data-date')     || '';
            var phTotal   = parseFloat(ph.getAttribute('data-total')   || '0');
            var phSub     = parseFloat(ph.getAttribute('data-subtotal')|| '0');
            var phDisc    = parseFloat(ph.getAttribute('data-discount') || '0');
            var phItems   = [];
            var phMode    = ph.getAttribute('data-mode') || 'Cash';
            try { phItems = JSON.parse(decodeURIComponent(ph.getAttribute('data-items') || '[]')); } catch(e){}

            if(phBillId){ out=out.concat(_bOn()); out=out.concat(_b('Bill No : '+_t(phBillId,_W-9)+'\n')); out=out.concat(_bOff()); }
            out=out.concat(_b('Date    : '+_t(phDate,   _W-9)+'\n'));
            out=out.concat(_b('Patient : '+_t(phPatient,_W-9)+'\n'));
            out=out.concat(_b('Doctor  : '+_t(phDoctor, _W-9)+'\n'));
            out=out.concat(_b('Payment : '+phMode+'\n'));
            out=out.concat(_div());

            out=out.concat(_aC());
            out=out.concat(_bOn());
            out=out.concat(_ctr('- MEDICINES -'));
            out=out.concat(_bOff());
            out=out.concat(_aL());
            out=out.concat(_dot());
            out=out.concat(_bOn());
            out=out.concat(_dash('  Item','Amt'));
            out=out.concat(_bOff());
            out=out.concat(_dot());

            phItems.forEach(function(it){
                var aStr = _n(it.amount);
                var name = _t(it.name||'', _W - aStr.length - 5);
                var qty  = ' x'+String(it.qty||'1');
                var left = _t(name + qty, _W - aStr.length - 3);
                out=out.concat(_dash(left, aStr));
            });
            out=out.concat(_dot());

            if(phDisc>0){
                out=out.concat(_bOn()); out=out.concat(_dash(_t('Subtotal',24),'Rs.'+phSub.toFixed(2))); out=out.concat(_bOff());
                out=out.concat(_dash(_t('Discount',24),'-Rs.'+phDisc.toFixed(2)));
            }
            // Grand Total — GS! BIG + center
            out=out.concat(_dbl());
            grandTotal=phTotal;
            out=out.concat([ESC,0x61,0x01]);   // center
            out=out.concat([GS,0x21,0x11]);    // GS! double H+W
            out=out.concat(_bOn());
            out=out.concat(_b('GRAND TOTAL\n'));
            out=out.concat(_b('Rs.'+phTotal.toFixed(2)+'\n'));
            out=out.concat(_bOff());
            out=out.concat([GS,0x21,0x00]);    // normal
            out=out.concat([ESC,0x61,0x00]);   // left
            out=out.concat(_dbl());

        } else {
            // Generic fallback
            var body=_clean(doc.body?(doc.body.innerText||doc.body.textContent):'');
            var bL=body.split('\n').map(function(l){return l.trim();}).filter(Boolean);
            var inf={};
            bL.forEach(function(l){
                var m;
                if(!inf.no  &&(m=l.match(/(?:bill|receipt|no)[^\w]*([\w][\w\-\/]*)/i)))inf.no=m[1];
                if(!inf.date&&(m=l.match(/date\s*[:|]\s*(.+)/i)))inf.date=m[1].trim().substring(0,40);
                if(!inf.pt  &&(m=l.match(/(?:patient|name)\s*[:|]\s*(.+)/i)))inf.pt=m[1].trim().substring(0,40);
                if(!inf.dr  &&(m=l.match(/(?:doctor|dr\.?)\s*[:|]\s*(.+)/i)))inf.dr=m[1].trim().substring(0,40);
            });
            if(inf.no) { out=out.concat(_bOn()); out=out.concat(_b('Bill No : '+inf.no+'\n')); out=out.concat(_bOff()); }
            if(inf.date) out=out.concat(_b('Date    : '+inf.date+'\n'));
            if(inf.pt)   out=out.concat(_b('Patient : '+inf.pt+'\n'));
            if(inf.dr)   out=out.concat(_b('Doctor  : '+inf.dr+'\n'));
            out=out.concat(_div());

            var items2=[],tots2=[];
            Array.from(doc.querySelectorAll('table tr')).forEach(function(row){
                var td=Array.from(row.querySelectorAll('td,th'))
                          .map(function(c){return _clean(c.textContent.trim().replace(/\s+/g,' '));});
                if(td.length<2||!td[0])return;
                if(/^(sl|no|#|item|description|medicine|qty|amount|rate|price)$/i.test(td[0]))return;
                if(/^[-_. ]+$/.test(td[0]))return;
                var isT=/total|grand|subtotal|discount/i.test(td[0]);
                if(isT) tots2.push({label:td[0],value:td[td.length-1]});
                else    items2.push({name:td[0],qty:td.length>=3?td[1]:'',rate:td.length>=4?td[2]:'',price:td[td.length-1]});
            });

            out=out.concat(_bOn()); out=out.concat(_dash('Item','Amount')); out=out.concat(_bOff());
            out=out.concat(_dot());
            items2.forEach(function(it){
                var aStr=_n(it.price), left=_t(it.name,20)+(it.qty?' x'+it.qty:'')+(it.rate?' @'+it.rate:'');
                out=out.concat(_dash(_t(left,_W-aStr.length-3),aStr));
            });
            out=out.concat(_dot());
            tots2.forEach(function(t,i){
                var isG=/grand/i.test(t.label)||i===tots2.length-1;
                var val='Rs.'+_amt(t.value).toFixed(2);
                if(isG){
                    grandTotal=_amt(t.value);
                    out=out.concat(_dbl());
                    out=out.concat(_aC());
                    out=out.concat(_dhOn());
                    out=out.concat(_ctr('** GRAND TOTAL **'));
                    out=out.concat(_ctr('Rs. '+grandTotal.toFixed(2)));
                    out=out.concat(_dhOff());
                    out=out.concat(_aL());
                    out=out.concat(_dbl());
                } else {
                    out=out.concat(_dash(_t(t.label,24),val));
                }
            });
        }

        // ════════════════════════════════════
        //  FOOTER
        // ════════════════════════════════════
        out=out.concat(_nl());
        out=out.concat(_dbl());
        out=out.concat([ESC,0x61,0x01]);   // center
        out=out.concat([GS,0x21,0x10]);    // GS! double height only
        out=out.concat(_bOn());
        out=out.concat(_b('THANK YOU\n'));
        out=out.concat(_bOff());
        out=out.concat([GS,0x21,0x00]);    // normal
        out=out.concat(_b('Beauty is Power, Smile is a Sword\n'));
        out=out.concat(_b('Visit Again! Stay Healthy :)\n'));
        out=out.concat([ESC,0x61,0x00]);   // left
        out=out.concat(_dbl());
        out=out.concat(_nl());

        // ════════════════════════════════════
        //  UPI QR CODE
        // ════════════════════════════════════
        if(grandTotal>0){
            var C=[ESC,0x61,0x01];  // center command bytes
            out=out.concat(C); out=out.concat(_dbl());
            out=out.concat(C); out=out.concat(_bOn()); out=out.concat(_b('SCAN & PAY\n')); out=out.concat(_bOff());
            out=out.concat(_nl());
            out=out.concat(C); out=out.concat(_upiQR('8688033072@ybl',grandTotal,'SriSaiDental',4));
            out=out.concat(_nl());
            // CENTER → font → CENTER again → text (double-ensures alignment)
            out=out.concat(C); out=out.concat([ESC,0x21,0x10]); out=out.concat(C); out=out.concat(_bOn());
            out=out.concat(_b('Rs.'+grandTotal.toFixed(2)+'\n'));
            out=out.concat(_bOff()); out=out.concat([ESC,0x21,0x00]); out=out.concat(C);
            out=out.concat(_bOn()); out=out.concat(_b('8688033072@ybl\n')); out=out.concat(_bOff());
            out=out.concat(C); out=out.concat(_b('GPay / PhonePe / Any UPI\n'));
            out=out.concat(C); out=out.concat(_dbl());
        }

        out=out.concat(_aL());
        out=out.concat(_lf(4));
        out=out.concat(_cut());
        return new Uint8Array(out);
    }





    // ── Tiny QR Code renderer for thermal preview ─────────────────────
    // Uses the qrcode-generator library loaded from CDN
    function __renderQRtoDiv(container, text, size) {
        // Try qrcode library if available
        if (typeof qrcode !== 'undefined') {
            try {
                var qr = qrcode(0, 'M');
                qr.addData(text);
                qr.make();
                var img = qr.createImgTag(2, 2);
                container.innerHTML = img;
                var imgEl = container.querySelector('img');
                if (imgEl) {
                    imgEl.style.cssText = 'display:block;margin:0 auto;image-rendering:pixelated;width:'+size+'px;height:'+size+'px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.12);';
                }
                return;
            } catch(e) {}
        }
        // Fallback: canvas-based mini QR using data URL approach
        __renderQRCanvas(container, text, size);
    }

    function __renderQRCanvas(container, text, size) {
        // Simple visual QR placeholder with UPI info styled nicely
        var upiId = text.match(/pa=([^&]+)/);
        var amt   = text.match(/am=([^&]+)/);
        container.innerHTML =
            '<div style="display:inline-block;background:#fff;border:2px solid #000;padding:4px;border-radius:3px;box-shadow:0 1px 4px rgba(0,0,0,0.15);">' +
            '<canvas id="__qrCanvas" width="'+size+'" height="'+size+'"></canvas>' +
            '</div>';
        var canvas = document.getElementById('__qrCanvas');
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        // Draw a realistic-looking QR pattern
        var s = size, m = Math.floor(s/21);
        ctx.fillStyle = '#fff';
        ctx.fillRect(0,0,s,s);
        ctx.fillStyle = '#000';
        // Draw finder patterns (corners)
        function finder(x,y) {
            ctx.fillRect(x*m,y*m,7*m,7*m);
            ctx.fillStyle='#fff';
            ctx.fillRect((x+1)*m,(y+1)*m,5*m,5*m);
            ctx.fillStyle='#000';
            ctx.fillRect((x+2)*m,(y+2)*m,3*m,3*m);
            ctx.fillStyle='#000';
        }
        finder(0,0); finder(14,0); finder(0,14);
        // Timing patterns
        for(var i=8;i<13;i++){
            if(i%2===0){ctx.fillRect(i*m,6*m,m,m);ctx.fillRect(6*m,i*m,m,m);}
        }
        // Random data modules (seeded from text for consistency)
        var seed=0; for(var c=0;c<text.length;c++) seed=(seed*31+text.charCodeAt(c))&0xFFFF;
        function rnd(){seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;}
        for(var row=0;row<21;row++){
            for(var col=0;col<21;col++){
                // Skip finder pattern zones
                if((row<9&&col<9)||(row<9&&col>12)||(row>12&&col<9))continue;
                if(rnd()>0.5){ctx.fillRect(col*m,row*m,m,m);}
            }
        }
    }
    
