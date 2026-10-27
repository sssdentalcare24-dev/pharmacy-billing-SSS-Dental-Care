/* Sri Sai Speciality Dental Care — billing app. Split from the original single index.html. */
    // ── Write bytes to BT printer in chunks ──────────────────
    async function _btWriteBytes(data) {
        var char = window._btPrinter.characteristic;
        if (!char) throw new Error('Printer not connected');
        var CHUNK = 100;
        for (var i = 0; i < data.length; i += CHUNK) {
            var chunk = data.slice(i, i + CHUNK);
            if (char.properties.writeWithoutResponse) {
                await char.writeValueWithoutResponse(chunk);
            } else {
                await char.writeValue(chunk);
            }
            await new Promise(function(r){ setTimeout(r, 20); });
        }
    }

    async function _doThermalPrint(html) {
        if (!window._btPrinter.connected || !window._btPrinter.characteristic) {
            showToast('❌ No printer connected. Tap 🖨️ in sidebar to connect.', 'error');
            return;
        }
        showToast('🖨️ Sending to thermal printer...', 'info');
        try {
            var bytes = _buildThermalBytes(html);
            await _btWriteBytes(bytes);
            showToast('✅ Printed successfully on thermal printer!', 'success');
        } catch(err) {
            if (err.name === 'NetworkError' || err.message.includes('GATT')) {
                window._btPrinter.connected = false;
                window._btPrinter.characteristic = null;
                _btUpdateUI();
                showToast('❌ Printer disconnected. Please reconnect.', 'error');
            } else {
                showToast('❌ Print failed: ' + err.message, 'error');
            }
        }
    }

    async function btTestPrint() {
        if (!window._btPrinter.connected) { showToast('No printer connected','warning'); return; }
        var dt = new Date().toLocaleDateString('en-IN', {day:'2-digit',month:'2-digit',year:'numeric'});
        var testHtml = '<div>Patient: Test Patient</div>' +
            '<div>Date: ' + dt + '</div>' +
            '<div>Doctor: Dr. T Venkat Rao</div>' +
            '<table>' +
            '<tr><th>Item</th><th>Qty</th><th>Amount</th></tr>' +
            '<tr><td>Test Medicine</td><td>2</td><td>Rs.120</td></tr>' +
            '<tr><td>Consultation</td><td>1</td><td>Rs.300</td></tr>' +
            '<tr><td>Subtotal</td><td></td><td>Rs.420</td></tr>' +
            '<tr><td>Grand Total</td><td></td><td>Rs.420</td></tr>' +
            '</table>';
        await _doThermalPrint(testHtml);
    }

    async function btWidthTest() {
        if (!window._btPrinter.connected) { showToast('No printer connected','warning'); return; }
        showToast('📏 Printing calibration test...', 'info');
        try {
            var out = [];
            out = out.concat(_init());
            out = out.concat([ESC,0x4D,0x00]);   // Font A
            out = out.concat([ESC,0x21,0x00]);   // Normal size
            out = out.concat(_gap(24));

            // ── SECTION 1: Width test ───────────────────────
            out = out.concat(_aC());
            out = out.concat(_bOn());
            out = out.concat(_b('** WIDTH CALIBRATION **\n'));
            out = out.concat(_bOff());
            out = out.concat(_aL());
            out = out.concat(_b('\n'));
            out = out.concat(_b('123456789012345678901234567890123456789012345678\n'));
            out = out.concat(_b('----10----20----30----40----50----\n'));
            out = out.concat(_b('Count digits LINE 1 → set width\n'));
            out = out.concat(_b('48=OK  42=set42  32=set32\n'));
            out = out.concat(_b('Current: _W='+_W+' chars\n'));
            out = out.concat(_b('--------------------------------\n'));

            // ── SECTION 2: Font size test ─────────────────────
            out = out.concat(_aC());
            out = out.concat(_bOn());
            out = out.concat(_b('** FONT SIZE TEST **\n'));
            out = out.concat(_bOff());
            out = out.concat(_aL());
            out = out.concat(_b('\n'));

            // Normal
            out = out.concat([ESC,0x21,0x00]);
            out = out.concat(_b('1. NORMAL (ESC!0x00)\n'));

            // Bold only
            out = out.concat([ESC,0x45,0x01]);
            out = out.concat(_b('2. BOLD   (ESC 45 01)\n'));
            out = out.concat([ESC,0x45,0x00]);

            // Double height
            out = out.concat([ESC,0x21,0x10]);
            out = out.concat(_b('3. DBL-H  (ESC!0x10)\n'));
            out = out.concat([ESC,0x21,0x00]);

            // Double width
            out = out.concat([ESC,0x21,0x20]);
            out = out.concat(_b('4.DBL-W  (ESC!0x20)\n'));
            out = out.concat([ESC,0x21,0x00]);

            // Double height + width
            out = out.concat([ESC,0x21,0x30]);
            out = out.concat(_b('5.BIG\n'));
            out = out.concat([ESC,0x21,0x00]);

            // GS ! method (alternative)
            out = out.concat([GS,0x21,0x11]);
            out = out.concat(_b('6.GS! BIG\n'));
            out = out.concat([GS,0x21,0x00]);

            out = out.concat(_b('\n'));
            out = out.concat(_b('Check: are sizes 1-6 different?\n'));
            out = out.concat(_b('YES=ESC/POS OK  NO=firmware issue\n'));
            out = out.concat(_b('--------------------------------\n'));

            // ── SECTION 3: Font A vs B ──────────────────────
            out = out.concat([ESC,0x21,0x00]);
            out = out.concat([ESC,0x4D,0x00]);
            out = out.concat(_b('Font A: ABCDEFGHIJ1234567890ab\n'));
            out = out.concat([ESC,0x4D,0x01]);
            out = out.concat(_b('Font B: ABCDEFGHIJ1234567890ab\n'));
            out = out.concat([ESC,0x4D,0x00]);
            out = out.concat(_b('--------------------------------\n'));

            out = out.concat([LF,LF,LF]);
            out = out.concat(_cut());
            await _btWriteBytes(new Uint8Array(out));
            showToast('✅ Test printed! Check font sizes 1-6.', 'success');
        } catch(err) {
            showToast('❌ Test failed: ' + err.message, 'error');
        }
    }

    function savePrinterWidth(val) {
        _W = val;
        localStorage.setItem('thermal_printer_width', String(val));
        // Update display
        var disp = document.getElementById('__currentWidthDisplay');
        if (disp) disp.textContent = val;
        // Highlight selected radio label
        [32,42,48].forEach(function(w){
            var lbl = document.getElementById('__wLabel'+w);
            if (lbl) lbl.style.borderColor = (w===val) ? '#e67e22' : '#ddd';
            if (lbl) lbl.style.background  = (w===val) ? '#fff8e1' : '#fff';
        });
        var msg = document.getElementById('__widthSavedMsg');
        var valEl = document.getElementById('__widthSavedVal');
        if (msg) msg.style.display = 'block';
        if (valEl) valEl.textContent = val;
        showToast('✅ Printer width set to ' + val + ' chars!', 'success');
        setTimeout(function(){ if(msg) msg.style.display='none'; }, 3000);
    }

    function btPrintPending() {
        if (__pendingPrintHtml) {
            closeBtPrinterPanel();
            setTimeout(function(){ _doThermalPrint(__pendingPrintHtml); }, 400);
        }
    }

    // Init on load
    document.addEventListener('DOMContentLoaded', function(){
        _btUpdateUI();
        // Update print choice BT button on open
        document.getElementById('__printChoiceDlg').addEventListener('click', function(e){
            if(e.target === this) __closePrintChoice();
        });
        // Load saved template previews in cards
        _refreshAllTmplPreviews();
        // Init printer width from saved value — set radio + highlight
        var savedW = parseInt(localStorage.getItem('thermal_printer_width') || '48');
        _W = savedW;
        var disp = document.getElementById('__currentWidthDisplay');
        if (disp) disp.textContent = savedW;
        [32,42,48].forEach(function(w){
            var lbl = document.getElementById('__wLabel'+w);
            var radio = lbl ? lbl.querySelector('input[type=radio]') : null;
            if (radio) radio.checked = (w === savedW);
            if (lbl) {
                lbl.style.borderColor = (w===savedW) ? '#e67e22' : '#ddd';
                lbl.style.background  = (w===savedW) ? '#fff8e1' : '#fff';
            }
        });
    });
    
