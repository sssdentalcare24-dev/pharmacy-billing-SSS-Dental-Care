/* Sri Sai Speciality Dental Care — billing app. Split from the original single index.html. */
    // ══════════════════════════════════════════════
    // COMBINED BILL
    // ══════════════════════════════════════════════
    var _cbCart = [];
    var _cbMode = 'Cash';

    function addCbMedicine() {
        var sel = document.getElementById('cb_medSelect');
        var qty = parseInt(document.getElementById('cb_medQty').value) || 1;
        if (!sel || !sel.value) { showToast('Select a medicine first', 'warning'); return; }
        var opt   = sel.options[sel.selectedIndex];
        var medId = sel.value;
        var price = parseFloat(opt.dataset.price) || 0;
        var stock = parseInt(opt.dataset.stock)   || 9999;
        var name  = opt.dataset.name || opt.text.split('—')[0].trim();
        if (!price) {
            var med = (window.medicines||[]).find(function(m){ return String(m.id)===String(medId); });
            if (med) { price=parseFloat(med.price)||0; stock=parseInt(med.stock)||9999; name=med.name; }
        }
        if (qty > stock) { showToast('Only ' + stock + ' in stock!', 'warning'); return; }
        var existing = _cbCart.find(function(c){ return String(c.medicineId)===String(medId); });
        if (existing) {
            existing.qty += qty;
            existing.amount = existing.qty * existing.price;
        } else {
            _cbCart.push({ medicineId:medId, medicineName:name, qty:qty, price:price, amount:qty*price });
        }
        sel.value = '';
        document.getElementById('cb_medQty').value = 1;
        // Batch DOM updates in one frame
        requestAnimationFrame(function(){
            renderCbCart();
            recalcCombined();
        });
        showToast('✅ ' + name + ' added', 'success');
    }

    function removeCbCartItem(idx) {
        _cbCart.splice(idx, 1);
        requestAnimationFrame(function(){ renderCbCart(); recalcCombined(); });
    }

    // Cart uses CSS classes — no inline styles = faster rendering
    function renderCbCart() {
        var tbody = document.getElementById('cb_cartBody');
        if (!tbody) return;
        if (_cbCart.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="cb-empty-row">No medicines added yet</td></tr>';
            return;
        }
        var rows = '';
        for (var i = 0; i < _cbCart.length; i++) {
            var item = _cbCart[i];
            rows += '<tr class="' + (i%2===0?'':'cb-row-alt') + '">' +
                '<td class="cb-td">' + item.medicineName + '</td>' +
                '<td class="cb-td cb-td-c">' + item.qty + '</td>' +
                '<td class="cb-td cb-td-r">₹' + item.price.toFixed(2) + '</td>' +
                '<td class="cb-td cb-td-r cb-td-bold">₹' + item.amount.toFixed(2) + '</td>' +
                '<td class="cb-td cb-td-c"><button class="cb-rm-btn" onclick="removeCbCartItem(' + i + ')">✕</button></td>' +
                '</tr>';
        }
        tbody.innerHTML = rows;
    }

    function recalcCombined() {
        var trAmt = parseFloat(document.getElementById('cb_tr_amount').value) || 0;
        var phAmt = 0;
        for (var i=0; i<_cbCart.length; i++) phAmt += _cbCart[i].amount;
        var grand = trAmt + phAmt;
        // Direct textContent updates — fastest DOM write
        document.getElementById('cb_medSubtotal').textContent = phAmt.toFixed(2);
        document.getElementById('cb_trShow').textContent      = trAmt.toFixed(2);
        document.getElementById('cb_phShow').textContent      = phAmt.toFixed(2);
        document.getElementById('cb_grandTotal').textContent  = grand.toFixed(2);
        scheduleCbPreview();
    }

    function clearCombinedForm() {
        ['cb_no','cb_patient','cb_phone','cb_tr_desc','cb_tr_amount','cb_tr_words'].forEach(function(id){
            var el=document.getElementById(id); if(el) el.value='';
        });
        var dr=document.getElementById('cb_doctor'); if(dr) dr.value='';
        var iq=document.getElementById('cb_medQty'); if(iq) iq.value=1;
        var is=document.getElementById('cb_medSelect'); if(is) is.value='';
        _cbCart=[];
        renderCbCart();
        recalcCombined();
        // Update placeholder to show next available number
        var cbn = document.getElementById('cb_no');
        if (cbn && typeof peekNextReceiptNo === 'function') {
            cbn.placeholder = 'Next: ' + peekNextReceiptNo() + ' (click Auto)';
        }
    }

    function buildCombinedBillHTML() {
        var no      = document.getElementById('cb_no').value      || '___________';
        var dateV   = document.getElementById('cb_date').value    || '';
        var patient = document.getElementById('cb_patient').value || '______________________________';
        var doctor  = document.getElementById('cb_doctor').value  || '—';
        var phone   = document.getElementById('cb_phone').value   || '';
        var trDesc  = document.getElementById('cb_tr_desc').value || '';
        var trAmt   = parseFloat(document.getElementById('cb_tr_amount').value)||0;
        var words   = document.getElementById('cb_tr_words').value|| '';
        var dateStr = dateV ? new Date(dateV).toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'}) : '_______________';
        var phAmt   = _cbCart.reduce(function(s,c){return s+parseFloat(c.amount);},0);
        var grand   = trAmt+phAmt;

        var trDescHtml = trDesc
            ? trDesc.split('\n').map(function(l){return '<div style="padding:4px 0;border-bottom:1px dotted #bbb;">'+(l.trim()||'&nbsp;')+'</div>';}).join('')
            : '<div style="padding:4px 0;border-bottom:1px dotted #bbb;">&nbsp;</div><div style="padding:4px 0;border-bottom:1px dotted #bbb;">&nbsp;</div><div style="padding:4px 0;border-bottom:1px dotted #bbb;">&nbsp;</div>';

        var medRows = _cbCart.length>0 ? _cbCart.map(function(item,i){
            return '<tr style="background:'+(i%2===0?'#fff':'#f8f9fa')+';">' +
                '<td style="padding:7px 10px;border-bottom:1px solid #eee;">'+item.medicineName+'</td>' +
                '<td style="padding:7px 6px;text-align:center;border-bottom:1px solid #eee;">'+item.qty+'</td>' +
                '<td style="padding:7px 6px;text-align:right;border-bottom:1px solid #eee;">&#8377;'+parseFloat(item.price).toFixed(2)+'</td>' +
                '<td style="padding:7px 10px;text-align:right;border-bottom:1px solid #eee;font-weight:600;">&#8377;'+parseFloat(item.amount).toFixed(2)+'</td>' +
                '</tr>';
        }).join('') : '<tr><td colspan="4" style="text-align:center;color:#aaa;padding:8px;">No medicines</td></tr>';

        var clinicAddr  = (typeof CONFIG!=='undefined')?(CONFIG.clinicAddress||'TKR College Road, Karmanghat, Hyderabad.'):'TKR College Road, Karmanghat, Hyderabad.';
        var clinicPhone = (typeof CONFIG!=='undefined')?(CONFIG.clinicPhone  ||'9396522492, 8688033072'):'9396522492, 8688033072';

        return '<style>@page{size:A4 portrait;margin:10mm;}#__cb,#__cb *{font-family:"Bookman Old Style","Book Antiqua",Bookman,Georgia,serif;box-sizing:border-box;margin:0;padding:0;}#__cb{width:100%;color:#000;background:#fff;font-size:13px;line-height:1.4;}#__cb h1{text-align:center;font-size:19px;font-weight:900;letter-spacing:2px;text-transform:uppercase;margin-bottom:3px;}#__cb .addr{text-align:center;font-size:11.5px;margin-bottom:2px;}#__cb .mob{text-align:center;font-size:11.5px;margin-bottom:10px;}#__cb .doctors{display:table;width:100%;border-collapse:collapse;border:1.5px solid #000;margin-bottom:10px;}#__cb .doc-cell{display:table-cell;width:50%;padding:8px 12px;text-align:center;font-size:12px;line-height:1.75;vertical-align:middle;}#__cb .doc-cell:first-child{border-right:1.5px solid #000;}#__cb .doc-cell strong{font-size:13px;display:block;}#__cb .receipt-title{text-align:center;font-size:15px;font-weight:900;letter-spacing:3px;margin-bottom:12px;text-decoration:underline;}#__cb .info-row{display:flex;align-items:flex-end;width:100%;margin-bottom:10px;}#__cb .i-left{display:flex;align-items:flex-end;flex:0 0 55%;padding-right:6px;}#__cb .i-right{display:flex;align-items:flex-end;flex:0 0 45%;}#__cb .i-lbl{flex:0 0 auto;white-space:nowrap;padding-right:7px;padding-bottom:2px;}#__cb .i-val{flex:1 1 0;border-bottom:1.5px solid #000;padding:0 3px 2px;min-height:18px;font-weight:bold;}#__cb .i-sep{flex:0 0 auto;white-space:nowrap;padding-right:7px;padding-bottom:2px;}#__cb .sec-hdr{font-size:13px;font-weight:900;letter-spacing:1px;margin:12px 0 6px;padding:5px 10px;background:#1e3f5a;color:white;border-radius:4px;-webkit-print-color-adjust:exact;print-color-adjust:exact;}#__cb .tr-box{border:1px solid #ccc;border-radius:6px;padding:8px 12px;min-height:55px;margin-bottom:8px;}#__cb .tr-amt-row{display:flex;justify-content:space-between;font-size:14px;font-weight:700;padding:7px 12px;background:#f0f4ff;border-radius:6px;margin-bottom:4px;-webkit-print-color-adjust:exact;print-color-adjust:exact;}#__cb table.meds{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:10px;}#__cb table.meds thead tr{background:#27ae60;color:white;-webkit-print-color-adjust:exact;print-color-adjust:exact;}#__cb table.meds thead th{padding:7px 10px;text-align:left;}#__cb table.meds thead th:not(:first-child){text-align:center;}#__cb table.meds thead th:last-child{text-align:right;}#__cb .summary-box{background:#f0f4ff;border-radius:8px;padding:12px 14px;margin-top:10px;-webkit-print-color-adjust:exact;print-color-adjust:exact;}#__cb .summary-box table{width:100%;border-collapse:collapse;font-size:13px;}#__cb .summary-box td{padding:5px 0;}#__cb .summary-box td:last-child{text-align:right;font-weight:700;}#__cb .grand-row td{font-size:18px;font-weight:900;color:#2c5aa0;border-top:2px solid #2c5aa0;padding-top:8px;}#__cb .sig-row{display:flex;justify-content:flex-end;margin-top:20px;font-size:13px;padding-right:4px;}#__cb .footer{text-align:center;font-size:10px;color:#555;font-style:italic;border-top:1px solid #ccc;margin-top:14px;padding-top:8px;line-height:1.6;}@media print{html,body{margin:0;padding:0;}#__cb{width:100%;}}</style>' +
        '<div id="__cb">' +
        '<h1>Sri Sai Speciality Dental Care</h1>' +
        '<div class="addr">'+clinicAddr+'</div>' +
        '<div class="addr">Mobile : '+clinicPhone+'</div>' +
        '<div class="mob"><strong>Timings :- MON-SUN &nbsp; 9AM TO 9PM</strong></div>' +
        '<div class="doctors"><div class="doc-cell"><strong>DR. T. VENKAT RAO</strong>Reg. A-734<br>B.D.S (Osm), M.R.S.H, FAGE,<br>(SENIOR DENTAL SURGEON)<br>Member, Indian Dental Association</div><div class="doc-cell"><strong>DR. T. SAI VAKULA</strong>Reg. A-15680<br>M.D.S.<br>MAXILLOFACIAL SURGEON &amp; IMPLANTOLOGIST<br>Specialist in Lasers &amp; Cosmetic Dentistry</div></div>' +
        '<div class="receipt-title">BILL SUMMARY</div>' +
        '<div style="margin-bottom:14px;font-size:13px;">' +
        '<div class="info-row"><div class="i-left"><span class="i-lbl">No.</span><span class="i-val">&nbsp;'+no+'</span></div><div class="i-right"><span class="i-sep">Date:</span><span class="i-val">&nbsp;'+dateStr+'</span></div></div>' +
        '<div class="info-row"><div class="i-left"><span class="i-lbl">Patient</span><span class="i-val">&nbsp;'+patient+'</span></div><div class="i-right"><span class="i-sep">Doctor:</span><span class="i-val">&nbsp;'+doctor+'</span></div></div>' +
        (phone?'<div class="info-row"><div class="i-left"><span class="i-lbl">Phone</span><span class="i-val">&nbsp;'+phone+'</span></div><div class="i-right"></div></div>':'') +
        '</div>' +
        '<div class="sec-hdr">&#9658; TREATMENT</div>' +
        '<div class="tr-box">'+trDescHtml+'</div>' +
        '<div class="tr-amt-row"><span>Treatment Amount</span><span>&#8377;'+trAmt.toFixed(2)+(words?' ('+words+')':'')+'</span></div>' +
        '<div class="sec-hdr">&#9658; PHARMACY / MEDICINES</div>' +
        '<table class="meds"><thead><tr><th>Medicine</th><th style="text-align:center">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr></thead><tbody>'+medRows+'</tbody></table>' +
        '<div class="summary-box"><table>' +
        '<tr><td style="color:#1e3f5a;">🦷 Treatment Charges</td><td>&#8377;'+trAmt.toFixed(2)+'</td></tr>' +
        '<tr><td style="color:#27ae60;">💊 Pharmacy Charges</td><td>&#8377;'+phAmt.toFixed(2)+'</td></tr>' +
        '<tr class="grand-row"><td><strong>Grand Total</strong></td><td><strong>&#8377;'+grand.toFixed(2)+'</strong></td></tr>' +
        '</table></div>' +
        '<div class="sig-row">Signature</div>' +
        '<div class="footer">Cherish your Yesterdays, Dream your Tomorrow, but live your today<br>Beauty is a Power and Smile is a Sword</div>' +
        '</div>';
    }

    // ── Debounce helper ──────────────────────────────────────────
    var _cbPreviewTimer = null;
    function scheduleCbPreview() {
        clearTimeout(_cbPreviewTimer);
        _cbPreviewTimer = setTimeout(function(){ updateCombinedPreview(); }, 800);
    }

    function updateCombinedPreview() {
        var p = document.getElementById('cb_preview');
        if (p) p.innerHTML = buildCombinedBillHTML();
    }
    function printCombinedBill() {
        if(!(document.getElementById('cb_patient').value||'').trim()){showToast('Enter patient name first','warning');return;}
        printBillHtml(buildCombinedBillHTML());
    }

    function shareCbWhatsApp() {
        var patient = (document.getElementById('cb_patient').value||'').trim();
        var phone   = (document.getElementById('cb_phone').value||'').trim();
        var doctor  = document.getElementById('cb_doctor').value || '';
        var no      = document.getElementById('cb_no').value || '';
        var dateV   = document.getElementById('cb_date').value || '';
        var trDesc  = (document.getElementById('cb_tr_desc').value||'').trim();
        var trAmt   = parseFloat(document.getElementById('cb_tr_amount').value)||0;
        var phAmt   = _cbCart.reduce(function(s,c){return s+parseFloat(c.amount);},0);
        var grand   = trAmt + phAmt;
        var dateStr = dateV ? new Date(dateV).toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'}) : '';

        if (!phone) { showToast('Enter patient phone number first','warning'); document.getElementById('cb_phone').focus(); return; }
        if (!patient) { showToast('Enter patient name first','warning'); return; }
        if (grand<=0) { showToast('Add treatment amount or medicines first','warning'); return; }

        // Build WhatsApp message
        var msg = '*🦷 SRI SAI SPECIALITY DENTAL CARE*\n';
        msg += 'TKR College Road, Karmanghat, Hyderabad\n';
        msg += '📞 8688033072 | 9396522492, 8688033072\n';
        msg += '─────────────────────────\n\n';
        msg += 'Hello *' + patient + '*! 😊\n\n';
        msg += '*COMBINED BILL*\n';
        if (no)      msg += 'Receipt No: ' + no + '\n';
        if (dateStr) msg += 'Date: ' + dateStr + '\n';
        if (doctor)  msg += 'Doctor: ' + doctor + '\n';
        msg += '\n';

        // Treatment section
        if (trDesc || trAmt > 0) {
            msg += '*🦷 TREATMENT*\n';
            if (trDesc) msg += trDesc + '\n';
            msg += 'Amount: ₹' + trAmt.toFixed(2) + '\n\n';
        }

        // Pharmacy section
        if (_cbCart.length > 0) {
            msg += '*💊 PHARMACY / MEDICINES*\n';
            _cbCart.forEach(function(item) {
                msg += '• ' + item.medicineName + ' × ' + item.qty + ' @ ₹' + parseFloat(item.price).toFixed(2) + ' = *₹' + parseFloat(item.amount).toFixed(2) + '*\n';
            });
            msg += 'Medicine Total: ₹' + phAmt.toFixed(2) + '\n\n';
        }

        msg += '─────────────────────────\n';
        msg += '🦷 Treatment: ₹' + trAmt.toFixed(2) + '\n';
        msg += '💊 Pharmacy:  ₹' + phAmt.toFixed(2) + '\n';
        msg += '*💰 GRAND TOTAL: ₹' + grand.toFixed(2) + '*\n';
        msg += '─────────────────────────\n\n';
        msg += 'Thank you for visiting Sri Sai Speciality Dental Care! 🙏\n';
        msg += '_Beauty is a Power and Smile is a Sword_ 😁';

        var cleanPhone = phone.replace(/[^\d]/g,'');
        if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;
        var url = 'https://wa.me/' + cleanPhone;
        window.open(url, '_blank');
    }
    function openCbPayment() {
        var patient=(document.getElementById('cb_patient').value||'').trim();
        if(!patient){showToast('Enter patient name first','warning');return;}
        var trAmt=parseFloat(document.getElementById('cb_tr_amount').value)||0;
        var phAmt=_cbCart.reduce(function(s,c){return s+parseFloat(c.amount);},0);
        var grand=trAmt+phAmt;
        if(grand<=0){showToast('Grand total is 0 — add treatment or medicines','warning');return;}
        document.getElementById('cbPmPatient').textContent=patient;
        document.getElementById('cbPmTotal').textContent='₹'+grand.toFixed(2);
        document.getElementById('cbPmTr').textContent=trAmt.toFixed(2);
        document.getElementById('cbPmPh').textContent=phAmt.toFixed(2);
        ['cbPmTendered','cbPmSplitCash','cbPmSplitUpi','cbPmCardRef'].forEach(function(id){var e=document.getElementById(id);if(e)e.value='';});
        document.getElementById('cbPmChange').textContent='₹0';
        document.getElementById('cbPmChange').style.color='#27ae60';
        document.getElementById('cbSplitSt').textContent='';
        document.getElementById('cbSplitSt').style.background='#f8f9fa';
        document.getElementById('cbQuickChips').innerHTML=[100,200,500,1000,2000].map(function(v){
            return '<button onclick="document.getElementById(\'cbPmTendered\').value='+v+';calcCbChange();" style="padding:8px 12px;border:1px solid #ddd;border-radius:8px;background:white;font-size:13px;font-weight:700;cursor:pointer;">₹'+v+'</button>';
        }).join('');
        var upiId=(typeof CONFIG!=='undefined'?CONFIG.upiId:'')||'';
        var upiName=(typeof CONFIG!=='undefined'?CONFIG.upiName:'')||'Sri Sai Dental';
        if(upiId.trim()){
            document.getElementById('cbUpiWarn').style.display='none';
            document.getElementById('cbUpiCard').style.display='block';
            document.getElementById('cbUpiAmt').textContent=grand.toFixed(2);
            document.getElementById('cbUpiIdShow').textContent=upiId;
            var lnk='upi://pay?pa='+encodeURIComponent(upiId)+'&pn='+encodeURIComponent(upiName)+'&am='+grand.toFixed(2)+'&cu=INR&tn='+encodeURIComponent('Dental');
            document.getElementById('cbUpiQr').src='https://api.qrserver.com/v1/create-qr-code/?size=200x200&data='+encodeURIComponent(lnk);
        } else {
            document.getElementById('cbUpiWarn').style.display='block';
            document.getElementById('cbUpiCard').style.display='none';
        }
        selectCbMode('Cash');
        var modal=document.getElementById('cbPayModal');
        modal.style.display='flex';
        // Force GPU layer before animating
        document.getElementById('cbPayCard').style.transform='translate3d(0,100%,0)';
        requestAnimationFrame(function(){
            requestAnimationFrame(function(){
                document.getElementById('cbPayCard').style.transform='translate3d(0,0,0)';
            });
        });
        document.body.style.overflow='hidden';
    }
    function closeCbPayModal(){document.getElementById('cbPayCard').style.transform='translate3d(0,100%,0)';setTimeout(function(){document.getElementById('cbPayModal').style.display='none';},340);document.body.style.overflow='';}
    function selectCbMode(mode){_cbMode=mode;['Cash','UPI','Card','Split'].forEach(function(m){var btn=document.getElementById('cbpm-'+m);var sec=document.getElementById('cbSec'+m);if(btn){btn.style.background=(m===mode)?'#2c5aa0':'white';btn.style.color=(m===mode)?'white':'#333';btn.style.borderColor=(m===mode)?'#2c5aa0':'#e0e0e0';}if(sec)sec.style.display=(m===mode)?'block':'none';});}
    function calcCbChange(){var total=parseFloat((document.getElementById('cbPmTotal').textContent||'').replace('₹',''))||0;var amt=parseFloat(document.getElementById('cbPmTendered').value)||0;var chg=amt-total;var el=document.getElementById('cbPmChange');el.textContent=chg>=0?'₹'+chg.toFixed(2):'-₹'+Math.abs(chg).toFixed(2);el.style.color=chg>=0?'#27ae60':'#e74c3c';}
    function calcCbSplit(){var total=parseFloat((document.getElementById('cbPmTotal').textContent||'').replace('₹',''))||0;var cash=parseFloat(document.getElementById('cbPmSplitCash').value)||0;var upi=parseFloat(document.getElementById('cbPmSplitUpi').value)||0;var rem=total-cash-upi;var el=document.getElementById('cbSplitSt');if(Math.abs(rem)<0.01){el.textContent='✅ Balanced';el.style.background='#e8f8ee';el.style.color='#27ae60';}else if(rem>0){el.textContent='⚠️ ₹'+rem.toFixed(2)+' still pending';el.style.background='#fff8e1';el.style.color='#e67e22';}else{el.textContent='❌ Overpaid by ₹'+Math.abs(rem).toFixed(2);el.style.background='#fff0f0';el.style.color='#e74c3c';}}
    function confirmCbPayment(){
        var total=parseFloat((document.getElementById('cbPmTotal').textContent||'').replace('₹',''))||0;
        if(_cbMode==='Cash'&&(parseFloat(document.getElementById('cbPmTendered').value)||0)<total){showToast('Amount tendered is less than total','warning');return;}
        if(_cbMode==='Split'){
            var c=parseFloat(document.getElementById('cbPmSplitCash').value)||0;
            var u=parseFloat(document.getElementById('cbPmSplitUpi').value)||0;
            if(Math.abs(c+u-total)>0.5){showToast('Split amounts must add up to total','warning');return;}
        }
        closeCbPayModal();

        var patient = document.getElementById('cb_patient').value || '';
        var doctor  = document.getElementById('cb_doctor').value  || '';
        var phone   = document.getElementById('cb_phone').value   || '';
        var no      = document.getElementById('cb_no').value      || '';
        var dateV   = document.getElementById('cb_date').value    || new Date().toISOString().split('T')[0];
        var trAmt   = parseFloat(document.getElementById('cb_tr_amount').value)||0;
        var phAmt   = _cbCart.reduce(function(s,c){return s+parseFloat(c.amount);},0);
        var grand   = trAmt + phAmt;
        var billId  = 'CB-' + Date.now();

        // ── Deduct stock locally ─────────────────────────────────
        _cbCart.forEach(function(item){
            var med=(window.medicines||[]).find(function(m){return String(m.id)===String(item.medicineId);});
            if(med) med.stock=Math.max(0,(parseInt(med.stock)||0)-item.qty);
        });

        // ── Push into local bills array → dashboard updates instantly ──
        var costTotal = _cbCart.reduce(function(s,c){
            var med=(window.medicines||[]).find(function(m){return String(m.id)===String(c.medicineId);});
            return s+(med?parseFloat(med.costPrice||0)*c.qty:0);
        },0);

        var localBill = {
            billId:      billId,
            patientName: patient,
            doctor:      doctor,
            phone:       phone,
            date:        dateV,
            subtotal:    grand,
            discount:    0,
            total:       grand,       // grand total = treatment + pharmacy
            costTotal:   costTotal,   // only pharmacy has cost; treatment profit = full amount
            paymentMode: _cbMode,
            items:       _cbCart.map(function(item){ return {
                medicineId:   item.medicineId,
                medicineName: item.medicineName,
                qty:          item.qty,
                price:        item.price,
                costPrice:    (function(){ var med=(window.medicines||[]).find(function(m){return String(m.id)===String(item.medicineId);}); return med?parseFloat(med.costPrice||0):0; })(),
                amount:       item.amount
            }; })
        };

        if(window.bills) window.bills.push(localBill);

        // ── Refresh all UI immediately ───────────────────────────
        if(typeof updateDashboard     ==='function') updateDashboard();
        if(typeof updateBillsTable    ==='function') updateBillsTable();
        if(typeof updateInventoryTable==='function') updateInventoryTable();
        if(typeof updateMedicineSelect==='function') updateMedicineSelect();

        // ── Print ────────────────────────────────────────────────
        saveCbRecordToHistory(billId);   // save to history BEFORE printing
        setTimeout(function(){printBillHtml(buildCombinedBillHTML());},200);
        showToast('✅ Dashboard updated! Syncing to Google Sheets...','success');
        // Update receipt no placeholder for next bill
        var cbn = document.getElementById('cb_no');
        if (cbn && typeof peekNextReceiptNo === 'function') {
            cbn.placeholder = 'Next: ' + peekNextReceiptNo() + ' (click Auto)';
        }

        // ── Save to Google Sheets in background ──────────────────
        saveCombinedBillToSheets(_cbMode, billId, dateV, grand, phAmt, costTotal, patient, doctor, phone, no);
    }

    function saveCombinedBillToSheets(payMode, billId, dateV, grand, phAmt, costTotal, patient, doctor, phone, no) {
        if(typeof CONFIG==='undefined'||!CONFIG.apiUrl||CONFIG.apiUrl.includes('YOUR_WEB_APP')){
            showToast('⚠️ Not connected to Google Sheets — bill saved locally only','warning'); return;
        }
        var trDesc  = document.getElementById('cb_tr_desc').value  || '';
        var trAmt   = parseFloat(document.getElementById('cb_tr_amount').value)||0;
        var trWords = document.getElementById('cb_tr_words').value || '';

        // ── 1. Treatment Sheet ────────────────────────────────────
        if (trAmt > 0 || trDesc) {
            var tp = new URLSearchParams();
            tp.append('action',      'saveTreatmentReceipt');
            tp.append('receiptNo',   no);
            tp.append('date',        dateV);
            tp.append('patient',     patient);
            tp.append('amount',      trAmt.toFixed(2));
            tp.append('amountWords', trWords);
            tp.append('treatments',  trDesc);
            fetch(CONFIG.apiUrl + '?' + tp.toString(), {method:'GET', redirect:'follow'})
                .then(function(r){return r.json();})
                .then(function(res){
                    if(res.success) showToast('☁️ Treatment saved to Sheets!','success');
                    else showToast('⚠️ Treatment sheet sync failed','warning');
                })
                .catch(function(){showToast('⚠️ Treatment sheet offline','warning');});
        }

        // ── 2. Bills Sheet + Bill Items Sheet + Stock deduction ───
        if (_cbCart.length > 0) {
            var bp = new URLSearchParams();
            bp.append('action',      'saveBill');
            bp.append('billId',      billId);
            bp.append('patientName', patient);
            bp.append('doctor',      doctor);
            bp.append('phone',       phone);
            bp.append('date',        dateV);
            bp.append('subtotal',    phAmt.toFixed(2));
            bp.append('discount',    '0');
            bp.append('total',       phAmt.toFixed(2));
            bp.append('costTotal',   costTotal.toFixed(2));
            bp.append('paymentMode', payMode);
            bp.append('paymentRef',  '');
            bp.append('items', JSON.stringify(_cbCart.map(function(item){
                var med=(window.medicines||[]).find(function(m){return String(m.id)===String(item.medicineId);});
                return {
                    medicineId:   item.medicineId,
                    medicineName: item.medicineName,
                    qty:          item.qty,
                    price:        item.price,
                    costPrice:    med?parseFloat(med.costPrice||0):0,
                    amount:       item.amount
                };
            })));
            fetch(CONFIG.apiUrl + '?' + bp.toString(), {method:'GET', redirect:'follow'})
                .then(function(r){return r.json();})
                .then(function(res){
                    if(res.success) showToast('☁️ Pharmacy bill saved to Sheets!','success');
                    else showToast('⚠️ Bill sheet sync failed: '+(res.error||''),'warning');
                })
                .catch(function(){showToast('⚠️ Bill sheet offline','warning');});
        }
    }

    function reprintCbBillFromAllBills(billId) {
        // Search window.bills first
        var bill = (window.bills||[]).find(function(b){ return b.billId === billId; });
        // Then search CB history by stored billId
        if (!bill) {
            var hist = getCbHistory().find(function(r){ return r.billId === billId; });
            if (hist) bill = hist;
        }
        if (!bill) { showToast('Bill not found — may have been cleared from history', 'error'); return; }

        // Snapshot current form state
        var snap = {
            no:    document.getElementById('cb_no').value,
            date:  document.getElementById('cb_date').value,
            pat:   document.getElementById('cb_patient').value,
            doc:   document.getElementById('cb_doctor').value,
            phone: document.getElementById('cb_phone').value,
            desc:  document.getElementById('cb_tr_desc').value,
            amt:   document.getElementById('cb_tr_amount').value,
            words: document.getElementById('cb_tr_words').value,
            cart:  _cbCart.slice()
        };

        // Fill form with bill data
        document.getElementById('cb_no').value        = bill.no       || bill.billId || '';
        document.getElementById('cb_date').value      = bill.date     || '';
        document.getElementById('cb_patient').value   = bill.patientName || bill.patient || '';
        document.getElementById('cb_doctor').value    = bill.doctor   || '';
        document.getElementById('cb_phone').value     = bill.phone    || '';
        document.getElementById('cb_tr_desc').value   = bill.trDesc   || '';
        document.getElementById('cb_tr_amount').value = bill.trAmt != null ? bill.trAmt : '';
        document.getElementById('cb_tr_words').value  = bill.trWords  || '';
        _cbCart = (bill.cart || bill.items || []).map(function(c){
            return { medicineId:c.medicineId||'', medicineName:c.medicineName||c.name||'', qty:c.qty, price:c.price, amount:c.amount };
        });

        var html = buildCombinedBillHTML();

        // Restore form
        document.getElementById('cb_no').value        = snap.no;
        document.getElementById('cb_date').value      = snap.date;
        document.getElementById('cb_patient').value   = snap.pat;
        document.getElementById('cb_doctor').value    = snap.doc;
        document.getElementById('cb_phone').value     = snap.phone;
        document.getElementById('cb_tr_desc').value   = snap.desc;
        document.getElementById('cb_tr_amount').value = snap.amt;
        document.getElementById('cb_tr_words').value  = snap.words;
        _cbCart = snap.cart;

        printBillHtml(html);
        showToast('🖨️ Reprinting Bill Summary...', 'success');
    }

    function shareWhatsAppCb(billId) {
        // Search window.bills first, then localStorage history
        var bill = (window.bills||[]).find(function(b){ return b.billId === billId; });
        if (!bill) {
            var hist = getCbHistory().find(function(r){ return r.billId === billId; });
            if (hist) bill = hist;
        }
        if (!bill) { showToast('Bill not found — may have been cleared from history', 'error'); return; }

        var phone = (String(bill.phone||'')).replace(/[^\d]/g,'');
        if (!phone) { showToast('No phone number saved for this bill','warning'); return; }
        if (phone.length === 10) phone = '91' + phone;

        var patient = bill.patientName || bill.patient || 'Patient';
        var trAmt   = parseFloat(bill.trAmt || 0);
        var items   = bill.cart || bill.items || [];
        var phAmt   = items.reduce(function(s,c){ return s + parseFloat(c.amount||0); }, 0);
        var grand   = parseFloat(bill.grand || bill.total || (trAmt + phAmt));

        var msg = '*🦷 SRI SAI SPECIALITY DENTAL CARE*\n';
        msg += 'TKR College Road, Karmanghat, Hyderabad\n';
        msg += '📞 8688033072 | 9396522492, 8688033072\n';
        msg += '─────────────────────────\n\n';
        msg += 'Hello *' + patient + '*! 😊\n\n';
        msg += '*BILL SUMMARY*\n';
        if (bill.no)     msg += 'Receipt No: ' + bill.no + '\n';
        if (bill.date)   msg += 'Date: ' + (bill.dateStr || bill.date) + '\n';
        if (bill.doctor) msg += 'Doctor: ' + bill.doctor + '\n';
        msg += '\n';

        if (bill.trDesc || trAmt > 0) {
            msg += '*🦷 TREATMENT*\n';
            if (bill.trDesc) msg += bill.trDesc + '\n';
            msg += 'Amount: ₹' + trAmt.toFixed(2) + '\n\n';
        }

        if (items.length > 0) {
            msg += '*💊 PHARMACY / MEDICINES*\n';
            items.forEach(function(item){
                var name = item.medicineName || item.name || 'Medicine';
                msg += '• ' + name + ' ×' + item.qty + ' = *₹' + parseFloat(item.amount||0).toFixed(2) + '*\n';
            });
            msg += 'Medicine Total: ₹' + phAmt.toFixed(2) + '\n\n';
        }

        msg += '─────────────────────────\n';
        if (trAmt > 0) msg += '🦷 Treatment: ₹' + trAmt.toFixed(2) + '\n';
        if (phAmt > 0) msg += '💊 Pharmacy:  ₹' + phAmt.toFixed(2) + '\n';
        msg += '*💰 GRAND TOTAL: ₹' + grand.toFixed(2) + '*\n';
        msg += '─────────────────────────\n\n';
        msg += 'Thank you for visiting Sri Sai Speciality Dental Care! 🙏\n';
        msg += '_Beauty is a Power and Smile is a Sword_ 😁';

        openWhatsApp(phone, msg);
    }
    function getCbHistory() {
        try { return JSON.parse(localStorage.getItem('cb_history') || '[]'); } catch(e) { return []; }
    }
    function saveCbHistory(list) {
        try { localStorage.setItem('cb_history', JSON.stringify(list)); } catch(e) {}
    }

    function renderCbHistory() {
        var list = getCbHistory();
        var el   = document.getElementById('cb_history_list');
        if (!el) return;
        if (!list.length) {
            el.innerHTML = '<div class="cb-empty-row" style="padding:20px;">No bill summaries saved yet.</div>';
            return;
        }
        var html = '';
        for (var ri = list.length - 1; ri >= 0; ri--) {
            var r   = list[ri];
            var idx = ri;
            var medSummary = (r.cart && r.cart.length > 0)
                ? r.cart.map(function(c){ return c.medicineName + ' ×' + c.qty; }).join(', ')
                : 'No medicines';
            var trPreview = (r.trDesc||'').replace(/\n/g,' ').substring(0,50) + ((r.trDesc||'').length>50?'...':'');
            html += '<div class="cb-hist-item">' +
                '<div class="cb-hist-row">' +
                    '<div class="cb-hist-info">' +
                        '<div class="cb-hist-name">🧾 #' + (r.no||'—') + ' — ' + (r.patient||'—') + (r.doctor?' | '+r.doctor:'') + '</div>' +
                        '<div class="cb-hist-meta">📅 ' + (r.dateStr||r.date||'—') + '</div>' +
                        (trPreview ? '<div class="cb-hist-meta">🦷 ' + trPreview + '</div>' : '') +
                        '<div class="cb-hist-meta">💊 ' + medSummary + '</div>' +
                        '<div class="cb-hist-total">Grand Total: ₹' + parseFloat(r.grand||0).toFixed(2) + '</div>' +
                    '</div>' +
                    '<div class="cb-hist-btns">' +
                        '<button onclick="loadCbRecord('+idx+')" style="background:#2c5aa0;">✏️ Load</button>' +
                        '<button onclick="reprintCbRecord('+idx+')" style="background:#27ae60;">🖨️ Print</button>' +
                        '<button onclick="deleteCbRecord('+idx+')" style="background:#e74c3c;">🗑️</button>' +
                    '</div>' +
                '</div>' +
            '</div>';
        }
        el.innerHTML = html;
    }

    function saveCbRecordToHistory(billId) {
        var trAmt = parseFloat(document.getElementById('cb_tr_amount').value)||0;
        var phAmt = _cbCart.reduce(function(s,c){return s+parseFloat(c.amount);},0);
        var record = {
            billId:  billId,
            no:      document.getElementById('cb_no').value      || '',
            date:    document.getElementById('cb_date').value    || '',
            dateStr: document.getElementById('cb_date').value
                        ? new Date(document.getElementById('cb_date').value).toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'})
                        : '',
            patient: document.getElementById('cb_patient').value || '',
            doctor:  document.getElementById('cb_doctor').value  || '',
            phone:   document.getElementById('cb_phone').value   || '',
            trDesc:  document.getElementById('cb_tr_desc').value || '',
            trAmt:   trAmt,
            trWords: document.getElementById('cb_tr_words').value|| '',
            cart:    _cbCart.map(function(c){ return { medicineId:c.medicineId, medicineName:c.medicineName, qty:c.qty, price:c.price, amount:c.amount }; }),
            grand:   trAmt + phAmt,
            payMode: _cbMode,
            savedAt: new Date().toISOString()
        };
        var list = getCbHistory();
        list.push(record);
        saveCbHistory(list);
        renderCbHistory();
    }

    function loadCbRecord(idx) {
        var list = getCbHistory();
        var r = list[idx]; if (!r) return;
        document.getElementById('cb_no').value        = r.no      || '';
        document.getElementById('cb_date').value      = r.date    || '';
        document.getElementById('cb_patient').value   = r.patient || '';
        document.getElementById('cb_doctor').value    = r.doctor  || '';
        document.getElementById('cb_phone').value     = r.phone   || '';
        document.getElementById('cb_tr_desc').value   = r.trDesc  || '';
        document.getElementById('cb_tr_amount').value = r.trAmt   || '';
        document.getElementById('cb_tr_words').value  = r.trWords || '';
        _cbCart = (r.cart || []).map(function(c){ return { medicineId:c.medicineId, medicineName:c.medicineName, qty:c.qty, price:c.price, amount:c.amount }; });
        renderCbCart();
        recalcCombined();
        window.scrollTo(0, 0);
        showToast('✅ Bill loaded — edit and reprint as needed', 'success');
    }

    function reprintCbRecord(idx) {
        loadCbRecord(idx);
        setTimeout(function(){ printBillHtml(buildCombinedBillHTML()); }, 300);
    }

    function deleteCbRecord(idx) {
        if (!confirm('Delete this bill from history?')) return;
        var list = getCbHistory();
        var rec = list[idx];
        list.splice(idx, 1);
        saveCbHistory(list);
        renderCbHistory();
        showToast('🗑️ Bill deleted', 'success');
        if (!CONFIG.apiUrl || CONFIG.apiUrl.includes('YOUR_WEB_APP')) return;
        var p = new URLSearchParams();
        p.append('action', 'deleteBill');
        p.append('billId', rec ? (rec.billId||rec.no||'') : '');
        p.append('savedAt', rec ? (rec.savedAt||'') : '');
        fetch(CONFIG.apiUrl + '?' + p.toString(), { method: 'GET', redirect: 'follow' })
            .then(function(r){ return r.json(); })
            .then(function(res){ if (res.success) showToast('☁️ Removed from Google Sheets', 'success'); else showToast('⚠️ Deleted locally — Sheets sync failed', 'warning'); })
            .catch(function(){ showToast('⚠️ Deleted locally only', 'warning'); });
    }

    function clearCbHistory() {
        if (!confirm('Clear ALL bill summary history? This cannot be undone.')) return;
        localStorage.removeItem('cb_history');
        renderCbHistory();
    }
    // ── End History ──────────────────────────────────────────────

    document.addEventListener('DOMContentLoaded', function(){
        var d=document.getElementById('cb_date'); if(d) d.valueAsDate=new Date();
        // Passive listeners — no scroll blocking
        ['cb_no','cb_patient','cb_phone','cb_tr_desc','cb_tr_words'].forEach(function(id){
            var el=document.getElementById(id);
            if(el) el.addEventListener('input', scheduleCbPreview, {passive:true});
        });
        var doc=document.getElementById('cb_doctor');
        if(doc) doc.addEventListener('change', scheduleCbPreview, {passive:true});
        var dat=document.getElementById('cb_date');
        if(dat) dat.addEventListener('change', scheduleCbPreview, {passive:true});
        // Defer non-critical renders
        setTimeout(renderCbHistory, 80);
        setTimeout(function(){
            var cbList=getCbHistory(); if(!cbList.length) return;
            cbList.forEach(function(r){
                var billId=r.billId||('CB-'+new Date(r.savedAt).getTime());
                if(!(window.bills||[]).find(function(b){return b.billId===billId;})&&window.bills){
                    window.bills.push({billId:billId,patientName:r.patient||'',doctor:r.doctor||'',
                        phone:r.phone||'',date:r.date||'',total:r.grand||0,trAmt:r.trAmt||0,
                        trDesc:r.trDesc||'',trWords:r.trWords||'',no:r.no||'',
                        cart:r.cart||[],items:r.cart||[],paymentMode:r.payMode||'—'});
                }
            });
            if(typeof updateBillsTable==='function') updateBillsTable();
            if(typeof updateDashboard==='function') updateDashboard();
        }, 1500);
    });
    // ══ END COMBINED BILL ══════════════════════════════════════
    
